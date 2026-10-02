# Local fork notes

Personal fork of [`Aymendje/pi-opencode-direct`](https://github.com/Aymendje/pi-opencode-direct),
pinned to upstream **0.1.7** (commit `8c359b8`). Upstream publishes no git tags, so the base
is pinned locally as `v0.1.7-pinned`. Remote `upstream` = the original repo.

## Why this fork exists

Upstream declares `@earendil-works/pi-ai` in **both** `dependencies` (pinned `0.86.1`) and
`peerDependencies` (`"*"`). Pi treats `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`,
and `typebox` as host-provided and warns on every startup:

> Host-provided extension packages must be declared in peerDependencies with a "*" range,
> not dependencies: @earendil-works/pi-ai.

Reported upstream as [issue #3](https://github.com/Aymendje/pi-opencode-direct/issues/3)
(2026-09-30, unanswered). Commit `Ship pi-ai as a real dependency (0.1.2)` shows the entry
was deliberate, not an oversight.

The commit here sets `dependencies` to `{}` and keeps the `0.86.1` pin in `devDependencies`
for typecheck/tests.

## Required: host symlinks

`src/provider.ts` imports deep subpaths (`@earendil-works/pi-ai/api/openai-completions.lazy`,
`.../api/openai-responses.lazy`, `.../providers/all`). Pi's host-module mapping does **not**
cover those subpaths for a package loaded from a local path, so Node falls back to ordinary
resolution from this directory and finds nothing. Without the symlinks the extension fails to
load:

```
Failed to load extension ".../src/index.ts": Cannot find module
'@earendil-works/pi-ai/api/openai-completions.lazy'
```

Recreate them after any `npm install` in this directory:

```bash
PI_HOST=~/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent
mkdir -p node_modules/@earendil-works
ln -sfn "$PI_HOST/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
ln -sfn "$PI_HOST"                          node_modules/@earendil-works/pi-coding-agent
```

**These must point at Pi's own bundled copy, not at `~/.pi/agent/npm/node_modules/`.** That npm
tree contains a *second, different* `pi-ai` (0.86.1) left over from when this package was
installed from npm; the host copy shipped inside `pi-coding-agent` is 1.0.0. Symlinking to the npm
tree looks correct — the extension loads and live calls succeed — but it puts a second `pi-ai`
instance, of a second version, in the process. That is precisely the duplicate-runtime-module
problem the Pi warning is about, just quieter. Verify with `realpath`.

Symlinks rather than copies is the point: Node resolves them to the host realpath, so the
extension and Pi share a **single** instance of the **same** version.

Because the symlinks point into the Pi installation, the fork has no dependency on
`~/.pi/agent/npm/` at all, and `pi update --extensions` cannot affect it.

`node_modules/` is gitignored, so the symlinks are local state and do not survive a fresh
clone on another machine. The `PI_HOST` path embeds a Node version — re-check it after
upgrading Node or Pi.

## Verifying

```bash
npm install --ignore-scripts   # devDeps for typecheck; wipes symlinks, so relink after
npm run verify                 # tsc --noEmit + node:test suite + npm pack --dry-run
rm -f *.tgz
# relink (see above), then confirm every import lands on the host realpath:
realpath node_modules/@earendil-works/pi-ai
```

Then, with the symlinks restored:

```bash
pi -p "Reply with exactly: FORK_OK" --provider opencode-zen-free --model big-pickle
```

## Upgrading

```bash
git fetch upstream --tags
git log --oneline HEAD..upstream/main     # review before moving
git checkout -b upstream-0.1.X <ref>
npm run verify
# re-apply the empty-dependencies change if upstream has not shipped it
```

If upstream ships a fix, drop the `dependencies` edit and the symlinks should still be
recreated after `npm install`, since the deep-subpath resolution gap is independent of the
manifest.