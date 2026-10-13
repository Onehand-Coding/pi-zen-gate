# Fork notes

Fork of [`Aymendje/pi-opencode-direct`](https://github.com/Aymendje/pi-opencode-direct),
base pinned to upstream **0.1.7** (commit `8c359b8`). Upstream publishes no git tags, so the base
is pinned locally as `v0.1.7-pinned`. Remote `upstream` is the original repo, kept **fetch-only**.

Upstream is a reference, not a base: fetch it and cherry-pick anything genuinely useful, but never
revert a local fix to match it.

## Why this fork exists

Three reasons, in order of how much they matter.

### 1. The Zen free-tier gate (the real one)

Upstream 0.1.7 no longer passes the anonymous gate. Two independent defects, both verified
live on 2026-10-13 against `/zen/v1`:

- **Session ids must encode a recent timestamp.** The 12 hex characters of `ses_...` are not
  random: OpenCode encodes `BigInt(Date.now()) * 0x1000n + counter`, bitwise-inverted for
  session ids (`packages/schema/src/identifier.ts`). The gate decodes them and rejects sessions
  that are not recent. Upstream derives those characters from a sha256 hash, so they decode to an
  arbitrary date — ours read 1971-10-24 — and every request 403s `FreeTierError`.
  Fixed here by `timestampHex()` in `src/provider.ts`, cached per Pi session with a 24h max age
  so affinity and `reasoning.encrypted_content` replay still work.
- **The User-Agent must not identify itself.** Upstream sends
  `... pi-opencode-direct/0.1.7`. That token alone turns a passing request into a 403. The
  version number is not what matters; the identity claim is.

Both produce the same `403 FreeTierError` as auth, quota, and network failures, which is why
this went unnoticed for a while. `CONTEXT.md` §9 records what the gate does and does not
require, including the parts that look relevant and are not.

### 2. Peer-only host dependencies

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

### 3. Host symlinks survive Pi updates (see below)

Upstream has no equivalent of `src/host-link.ts`, so every `pi update` requires manual
relinking.

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

Recreate them after any `npm install` in this directory, **and after every `pi update`**
(see "Managed install" below — each update lands a new release dir, so the old
symlinks dangle and the extension fails to load with
`Cannot find module '@earendil-works/pi-ai/api/openai-completions.lazy'`):

```bash
PI_AGENT="${XDG_CONFIG_HOME:-$HOME/.config}/pi/agent"; [[ -d $PI_AGENT ]] || PI_AGENT="$HOME/.pi/agent"
PI_NM="$PI_AGENT/install/releases/$(<"$PI_AGENT/install/current-version")/node_modules/@earendil-works"
mkdir -p node_modules/@earendil-works
# Remove first: after `npm install` these are real directories, and `ln -sfn` against a
# real directory nests the link inside it (…/pi-ai/pi-ai) instead of replacing it.
rm -rf node_modules/@earendil-works/pi-ai node_modules/@earendil-works/pi-coding-agent
ln -s "$PI_NM/pi-ai"           node_modules/@earendil-works/pi-ai
ln -s "$PI_NM/pi-coding-agent" node_modules/@earendil-works/pi-coding-agent
# confirm both resolve into the managed release, not the npm tree
realpath node_modules/@earendil-works/pi-ai
ls -l node_modules/@earendil-works/   # both must be 'l' (symlinks), never 'd' (dirs)
```

Managed installs keep `pi-ai` as a **sibling** of `pi-coding-agent` in the release's
flat `node_modules/` — it is *not* nested under `pi-coding-agent/node_modules/` as it
was in the old global npm layout. Point at `$PI_NM/pi-ai`, not
`$PI_NM/pi-coding-agent/node_modules/@earendil-works/pi-ai`.

**These must point at Pi's own bundled copy, not at `~/.pi/agent/npm/node_modules/`.** That npm
tree contains a *second, different* `pi-ai` (0.86.1) left over from when this package was
installed from npm; the managed release ships `pi-ai` at the same version as Pi itself
(1.0.3 as of the 1.0.2 → 1.0.3 update). Symlinking to the npm tree looks correct — the
extension loads and live calls succeed — but it puts a second `pi-ai` instance, of a
second version, in the process. That is precisely the duplicate-runtime-module
problem the Pi warning is about, just quieter. Verify with `realpath`.

Symlinks rather than copies is the point: Node resolves them to the host realpath, so the
extension and Pi share a **single** instance of the **same** version.

Because the symlinks point into the Pi installation, the fork has no dependency on
`~/.pi/agent/npm/` at all, and `pi update --extensions` cannot affect it.

`node_modules/` is gitignored, so the symlinks are local state and do not survive a fresh
clone on another machine. The path embeds the Pi release version — re-link after
upgrading Pi.

### Drift is repaired automatically, and reported if it can't be

Relinking is easy to forget and the failure is silent: `pi update` leaves the previous
release on disk, so a stale symlink keeps *resolving* and simply loads a second copy of
`pi-ai` into the process. `src/host-link.ts` therefore relinks on **import**, not on
`session_start`:

- It compares the release Pi is running (`process.argv[1]` → `…/install/releases/<version>/`)
  against the release each host symlink resolves to, and repoints any that disagree.
- **Ordering is the whole point.** `index.ts` must keep `import … from "./host-link.ts"`
  as its *first* import: ESM evaluates imports depth-first in declaration order, so the
  relink runs before `./provider.ts` resolves `@earendil-works/pi-ai`. Repairing at
  `session_start` instead would be too late — the stale copy is already in memory, and
  the fix would only apply to the next process.
- Only **symlinks** are ever replaced. A real directory is left alone (that is what
  `npm install` leaves, and deleting one could destroy a legitimate install).
- Nothing happens outside a managed install: `releasePaths()` returns null for an npm or
  dev layout, which is what keeps it inert on another machine.

`hostModuleDrift()` is the backstop for the cases relinking cannot handle (read-only
filesystem, a real directory in the way). On divergence it fires a warning notification
and a `⚠ pi-ai drift (Pi <version>)` status entry, naming both releases. It returns `null`
whenever either side is unknown, so it never warns on something it cannot verify.

Verified by pointing both symlinks at the previous release and running `pi` once: the
process loaded the **running** release and the links were left pointing at it.

## Managed install (migrated from global npm)

Pi was migrated on 2026-10-05 from a global npm install to a **managed** install:

- launcher: `~/.local/bin/pi` → `~/.pi/agent/bin/pi` (a shell shim)
- `~/.pi/agent/bin/pi` reads `~/.pi/agent/install/current-version` and execs
  `~/.pi/agent/install/releases/<version>/node_modules/.bin/pi`
- releases are version-pinned dirs: `releases/1.0.4/node_modules/@earendil-works/…`
- **Node comes from your normal PATH** (nvm, as of 2026-10-07: `process.execPath` is
  `~/.nvm/versions/node/v24.18.0/bin/node`). The shim prepends `~/.local/share/pi-node/current/bin`,
  but that directory does not exist, so the prepend is a no-op and a system/nvm Node is used.

Consequences for this fork:

- The old `PI_HOST=~/.nvm/.../lib/node_modules/@earendil-works/pi-coding-agent` no longer
  exists, so existing symlinks **dangle** after the migration and after every update.
- `npm root -g` is now unrelated to Pi. Any script that located Pi through it
  (e.g. the workbench `scripts/pi-no-diff-highlight.sh`) must read
  `install/current-version` instead. The old npm prefix still holds a **stale
  `pi-ai` 0.86.1** — never point at it.
- `pi update` is self-contained now; the migration's `npm uninstall -g` already ran.

## The free-model roster comes from pi-ai, not from Zen

`freeModels()` derives the roster from `getBuiltinModels("opencode")` — the catalogue
**compiled into pi-ai** (`dist/providers/data/opencode.json`). `refreshModels()` only
*intersects* that baseline with Zen's live `GET /zen/v1/models`, so it can drop a model
Zen retired but can never add one Zen introduced.

Consequence: when Zen ships a free model before the next pi-ai release, it is invisible here —
and neither `pi update` nor `pi update --models` helps, because the catalogue belongs to
pi-ai (host-provided) rather than to a refreshable cache. A fresh `pi-ai` fixes it on its own;
check `freeModels()` before adding anything by hand.

Until then, add it to `EXTRA_FREE_MODELS` in `src/provider.ts` and delete the entry once the
baseline reports it. Take metadata from two sources, which answer different halves:

- **Zen docs model table** (`https://opencode.ai/docs/zen`) — the endpoint and SDK, i.e. the
  `api` shape. A model sent to the wrong shape fails as a Zen-side **503 "Endpoint is
  unavailable"**, not a client error, so this is the field that must be right.
- **models.dev** (`https://models.dev/api.json`, provider `opencode`) — limits, modalities,
  reasoning efforts.

### Forcing a stale roster to re-derive

Pi persists each provider's refreshed roster in `~/.pi/agent/models-store.json`, and a
stored entry **shadows** the live `getModels()` result — including after you add a model to
`EXTRA_FREE_MODELS`. `pi --list-models` keeps showing the old list until the entry is dropped:

```bash
cp ~/.pi/agent/models-store.json /tmp/models-store.backup.json
node -e 'const f=process.env.HOME+"/.pi/agent/models-store.json";const j=require("fs");const s=JSON.parse(j.readFileSync(f));delete s["opencode-zen-free"];j.writeFileSync(f,JSON.stringify(s,null,2))'
pi --list-models | grep zen     # rebuilds from the live provider
```

Note that `pi update --models` refreshes only Pi's own built-in catalogues; it does **not**
call this provider's `refreshModels()`.

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