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

Recreate them after any `npm install` in this directory (npm replaces the symlinks with real
directories, which reintroduces a second module instance):

```bash
mkdir -p node_modules/@earendil-works
ln -sfn ~/.pi/agent/npm/node_modules/@earendil-works/pi-ai \
        node_modules/@earendil-works/pi-ai
ln -sfn ~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent \
        node_modules/@earendil-works/pi-coding-agent
```

Symlinks are used deliberately, not copies: Node resolves them to the host realpath, so the
extension and Pi share a **single** `pi-ai` instance. A real npm-installed copy — which is
what upstream's `dependencies` entry produces — creates the duplicate runtime modules the Pi
warning is about.

`node_modules/` is gitignored, so the symlinks are local state and do not survive a fresh
clone on another machine.

## Verifying

```bash
npm install --ignore-scripts   # devDeps for typecheck; wipes symlinks, so relink after
npm run verify                 # tsc --noEmit + node:test suite + npm pack --dry-run
rm -f *.tgz
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