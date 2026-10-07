import { existsSync, lstatSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Host packages Pi provides. This package must load Pi's copies, never its own:
 * two copies of pi-ai in one process is the duplicate-module hazard the package
 * exists to avoid.
 */
export const HOST_PACKAGES = ["pi-ai", "pi-coding-agent"] as const;
const SCOPE = "@earendil-works";

/**
 * Derive Pi's release layout from the running entrypoint:
 * `/…/install/releases/1.0.4/node_modules/.bin/pi` →
 * `{ releasesDir: "/…/install/releases", release: "1.0.4" }`.
 *
 * Null for a non-managed install (npm, a dev checkout, the test runner), which is
 * the signal to stay out of the way entirely.
 */
export function releasePaths(piEntry: string | undefined): { releasesDir: string; release: string } | null {
  const match = piEntry?.match(/^(.*[/\\]releases[/\\])([^/\\]+)[/\\]/);
  if (!match) return null;
  return { releasesDir: match[1].replace(/[/\\]+$/, ""), release: match[2] };
}

/** The release segment of a path, e.g. `…/releases/1.0.4/…` → `1.0.4`. */
export function hostRelease(path: string | undefined): string | undefined {
  return releasePaths(path)?.release;
}

export interface RelinkResult {
  /** Symlinks repointed at the running release. */
  relinked: string[];
  /** Already pointing at the running release. */
  current: string[];
  /** Left untouched: a real directory, or no such package in the release. */
  skipped: string[];
}

/**
 * Point this package's host symlinks at the release Pi is actually running.
 *
 * Only ever replaces a symlink. A real directory is left alone and reported as
 * skipped: `npm install` creates one, and removing it could destroy a legitimate
 * install. Best-effort throughout — a failure here must never stop the extension
 * from loading.
 */
export function relinkHostModules(input: { linkDir: string; releasesDir: string; release: string }): RelinkResult {
  const result: RelinkResult = { relinked: [], current: [], skipped: [] };
  for (const pkg of HOST_PACKAGES) {
    const link = join(input.linkDir, pkg);
    const desired = join(input.releasesDir, input.release, "node_modules", SCOPE, pkg);
    let isLink = false;
    try {
      isLink = lstatSync(link).isSymbolicLink();
    } catch {
      // Missing entirely; fall through and create it.
    }
    try {
      if (existsSync(link) && !isLink) {
        result.skipped.push(pkg);
        continue;
      }
      if (isLink && realpathSync(link) === desired) {
        result.current.push(pkg);
        continue;
      }
      if (!existsSync(desired)) {
        result.skipped.push(pkg);
        continue;
      }
      rmSync(link, { force: true });
      symlinkSync(desired, link);
      result.relinked.push(pkg);
    } catch {
      result.skipped.push(pkg);
    }
  }
  return result;
}

/**
 * Detect host-symlink drift: Pi running from a different release than the one
 * this extension's own pi-ai resolves to.
 *
 * Pi keeps every previous release on disk, so after `pi update` the symlinks keep
 * *resolving* — they just point at the previous release, silently loading a second
 * copy of pi-ai with no error to notice. Compare the running release against the
 * resolved one and say so out loud.
 *
 * Null when the two agree or either side is unknown — never warn on something we
 * cannot verify. Acts as the backstop for the relink above: if the filesystem is
 * read-only or the link is a real directory, this is how you find out.
 */
export function hostModuleDrift(input: {
  piEntry?: string | undefined;
  extensionModuleDir?: string | undefined;
}): string | null {
  const running = hostRelease(input.piEntry);
  const resolved = hostRelease(input.extensionModuleDir);
  if (!running || !resolved || running === resolved) return null;
  return `pi-opencode-direct: host symlink drift — Pi runs release ${running}, but this extension `
    + `resolves pi-ai from ${resolved}. Two copies of pi-ai are now in this process. Re-run the `
    + `host-symlink block in the fork's FORK.md (rm -rf the two @earendil-works entries, then ln -s).`;
}

// Import-time side effect, and it must stay first in index.ts's import list.
//
// ESM evaluates imports depth-first in declaration order, so this runs *before*
// ./provider.ts pulls in pi-ai. That ordering is the whole point: by session_start
// the old copy is already in memory and relinking would only help the next run —
// relinking here is what makes *this* process load the running release.
try {
  const paths = releasePaths(process.argv[1]);
  if (paths) {
    relinkHostModules({
      linkDir: fileURLToPath(new URL("../node_modules/@earendil-works", import.meta.url)),
      ...paths,
    });
  }
} catch {
  // Never block extension loading; hostModuleDrift() reports what went wrong.
}