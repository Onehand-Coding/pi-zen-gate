# pi-opencode-direct

> Persistent project memory — durable knowledge only.
>
> This file is NOT a changelog, session log, TODO list, or git history.
> Git already records what changed and when. This file records what
> Git cannot: architecture, philosophy, non-goals, decisions, conventions,
> domain rules, and the current state of unfinished or partial work.
>
> Update ONLY when durable project knowledge changes (see Maintenance
> Rules at the bottom). Do not touch this file for commits, bug fixes,
> refactors, or session summaries.

---

## 1. Project Overview

**Purpose:** A Pi extension that gives Pi access to OpenCode Zen's free models
over native HTTP, with no OpenCode installation, login, API key, server,
container, or LiteLLM in the way. It works by impersonating the official
OpenCode client on the wire, because the anonymous free tier is gated on that.

**Target Users:**
- The maintainer, installing it into their own Pi (local path install)
- Pi and OMP users who install the published package

**Current Milestone:** Maintenance, diverging from upstream.

**Current Development Focus:** Keeping the Zen free-tier fingerprint current,
since the gate is enforced server-side and can change without notice.

**Longer-Term Direction:** Publish to npm under a new package name so other Pi
users can install a version that actually passes the gate.

---

## 2. Technology Stack

| Component | Choice |
|---|---|
| Language | TypeScript, run directly via `node --experimental-strip-types` (no build step) |
| Module system | ESM (`"type": "module"`) |
| Runtime | Node >= 22.19.0 (CI matrix: 22, 24, 26) |
| Runtime dependencies | **none** (`dependencies: {}`) |
| Peer dependencies | `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, both `"*"` |
| Dev dependencies | pinned `pi-ai` / `pi-coding-agent` 0.86.1, `typescript`, `@types/node` |
| Testing | `node:test` via `--experimental-strip-types --test test/*.test.ts` |
| Typecheck | `tsc --noEmit` |
| Lint | none configured |
| CI | `.github/workflows/ci.yml`: `npm ci --ignore-scripts` then `npm run verify` |

CI resolves the peer packages from the npm registry via `devDependencies`, so it
does not depend on the local host symlinks described in FORK.md.

---

## 3. Repository Structure

```text
src/provider.ts   # the whole provider: model roster, identity, interception layers
src/host-link.ts  # repairs host symlinks at import time (fork-only, not upstream)
src/index.ts      # extension entry point; lifecycle hooks
test/             # provider.test.ts (unit), live.ts (opt-in real network)
FORK.md           # fork-specific notes: host symlinks, managed install, roster
```

---

## 4. Architecture

**Overall:** One provider module plus an import-time repair step. The guiding
constraint is that the extension must be indistinguishable from the official
OpenCode client on the wire, so identity is applied at every layer that could
send a request rather than at one call site.

**Folder Organization:** Flat. Three source files, each with a distinct job:
`provider.ts` owns behavior, `host-link.ts` owns environment repair, `index.ts`
is the manifest-facing entry.

**Data Flow:**
Pi session → `index.ts` → `provider.ts` registers the `opencode-zen-free`
provider → every outgoing Zen request passes through one of three interception
layers (Models wrapper, compat registry patch, or the global fetch /
`node:http` guards) → Zen free tier → response normalized back to pi-ai events.

The interception layers are cumulative on purpose. Each catches a caller the
others miss: the Models path covers normal streaming, the compat patch covers
direct `pi-ai/compat` callers, and the fetch guards cover anything that reaches
the network without going through pi-ai at all.

---

## 5. Non-Goals

- No OpenCode installation, login, account, or API key. That is the entire point.
- No LiteLLM, local gateway process, or persistent daemon.
- No new runtime dependencies. Anything that belongs in the host belongs in the
  host.
- No vendoring of other free-model providers (Kilo, OVH, Cline). Those are
  separate concerns with separate terms.
- Not a general-purpose OpenCode proxy. It serves Pi's model traffic and nothing else.

---

## 6. Architecture Rules

- `src/index.ts` must keep `import … from "./host-link.ts"` as its **first**
  import. ESM evaluates imports depth-first in declaration order, so the symlink
  repair must run before `./provider.ts` resolves `@earendil-works/pi-ai`.
  Repairing at `session_start` is too late: the stale copy is already loaded.
- Host symlinks are replaced **only when they are symlinks**. A real directory is
  left alone, because that is what `npm install` leaves and deleting one could
  destroy a legitimate install.
- Never point the host symlinks at `~/.pi/agent/npm/node_modules/`. That tree
  holds a second, different `pi-ai`. They must resolve to Pi's own bundled copy.
- Identity headers must be applied on every Zen-bound path. A caller that
  bypasses all interception layers still reaches Zen, so the guards stay.
- `@earendil-works/pi-ai` is peer-only. Never add it back to `dependencies`; Pi
  warns on every startup and the host already provides it.

---

## 7. Coding Conventions

**General:**
- Tabs-free, one-space indentation (inherited from upstream; match it).
- Comments explain *why* a non-obvious upstream behavior is being worked around,
  with the measurement or error text that justifies them.
- `set -euo pipefail` equivalent discipline in scripts: fail loudly.

**TypeScript:**
- No build step. Source is the shipped artifact (`files` ships `src/**/*.ts`).
- Exported helpers carry doc comments recording the verified upstream behavior.

**Testing:**
- `node:test`, no framework. Every `src/*.ts` concern has a matching test.
- `test/live.ts` is opt-in and never part of `npm test`: it spends real free-tier
  quota and must not run in CI.
- Assertions on wire identity are the point of this suite. Treat them as
  contract tests, not incidental coverage.

---

## 8. Project Decisions

### Peer-only host dependencies
**Choice:** `dependencies: {}`, host packages declared in `peerDependencies` with `"*"`.
**Status:** Current
**Reason:** Pi treats `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, and
`typebox` as host-provided and warns on every startup when they appear as real
dependencies. Upstream declared both, deliberately (commit "Ship pi-ai as a real
dependency"). Reported as
[issue #3](https://github.com/Aymendje/pi-opencode-direct/issues/3) (2026-09-30,
unanswered).
**Alternatives Considered:** Keeping the dependency and tolerating the warning.
Rejected: the warning fires on every Pi start and the duplicate-runtime-module
hazard is real.

### Zen identity is applied at every interception layer
**Choice:** Models wrapper + compat registry patch + global fetch guard + `node:http` guard.
**Status:** Current
**Reason:** Each layer catches callers the others miss. Removing any one of them
reopens a path where a Zen request goes out without the identity and 403s.

### Fix the gate rather than wait for upstream
**Choice:** Maintain our own gate fixes (timestamp-encoded session ids, non-self-identifying User-Agent) instead of tracking upstream for them.
**Status:** Current (as of 2026-10-13)
**Reason:** Upstream's latest release (0.1.7, published 2026-09-21) carries both
defects and the peer-dependency mistake, and the one filed issue went unanswered.
Upstream is treated as a reference, not a base: fetch it, cherry-pick anything
genuinely useful, never revert a local fix to match it.
**Alternatives Considered:** Reinstalling upstream, which was verified to still
carry both gate defects and to lose the host-symlink repair.

### Publish under a new npm name
**Choice:** Publish to npm under a name other than `pi-opencode-direct`.
**Status:** Experimental (name not yet chosen)
**Reason:** The upstream name is taken on npm, and publishing under it would
imply maintaining someone else's package identity.

### Repair host symlinks on import, not on session start
**Choice:** `host-link.ts` relinks at module import.
**Status:** Current
**Reason:** Import order guarantees the repair precedes `pi-ai` resolution. At
`session_start` the stale copy is already in memory, so the fix would only apply
to the next process.

---

## 9. Domain Knowledge

The anonymous Zen free tier is gated on being the official OpenCode client. The
gate is server-side and enforced on the wire. What it requires, as measured:

- **`x-opencode-session` must encode a recent timestamp.** The 12 hex characters
  are not random: OpenCode encodes `BigInt(Date.now()) * 0x1000n + counter`,
  bitwise-inverted for session ids (`packages/schema/src/identifier.ts`). The
  gate decodes them. A sha256-derived id decodes to an arbitrary date (the
  previous implementation decoded to 1971-10-24) and is rejected.
- **The User-Agent must not carry a non-official token.** A suffix identifying
  this package (`pi-opencode-direct/0.1.7`) turns a passing request into a 403.
  The version number itself is not checked; the identity claim is.
- **Streaming and a populated tool list are part of the shape.** A request with
  no tools is rejected; tool count and naming are not otherwise load-bearing.

What the gate does **not** require, each verified by replaying an identical body
with one variable changed: `x-opencode-session-id`, `x-session-affinity`,
`x-opencode-project`, `x-opencode-client` value, header name casing,
`Authorization: Bearer public` vs a Console API key, `tool_choice`,
`reasoning_effort`, `stream_options`, and the `/zen/v1` vs `/inference/v1` path.

**A Console API key does not unlock the free models.** Key-authenticated direct
calls 403 on the free roster exactly like anonymous ones. Keys only matter for
the paid catalogue.

---

## 10. Known Gotchas

### The gate fails intermittently
- The same byte-identical request can return 200 and then 403 minutes apart,
  while the real OpenCode client keeps working throughout. A single failed
  request proves nothing in either direction.
- Consequence for methodology: never conclude "the fix works" or "the fix failed"
  from one call. Interleave a known-good replay with the candidate and compare,
  and repeat.

### The gate is asymmetric between what you send and what Pi sends
- The decisive technique is to capture what the real client puts on the wire,
  replay those exact bytes through `curl`, and diff against what Pi actually
  sends. Do not reconstruct "clean" headers by hand and assume they match: that
  mistake cost hours and hid two real defects, because the reconstruction was
  always cleaner than Pi's real request.
- Reading Pi's actual outbound headers is the ground truth. `src/provider.ts`
  logs them under `PI_OPENCODE_DIRECT_DEBUG=1`.
- `x-stainless-*` telemetry (pi-ai's OpenAI path is Stainless-generated) is
  **not** a gate factor. It looks damning and is not.

### Host symlinks
- `npm install` in this directory replaces the symlinks with real directories,
  and every `pi update` makes them dangle. Both break the extension with a
  misleading `Cannot find module '@earendil-works/pi-ai/api/...'`.
- Verify with `realpath node_modules/@earendil-works/pi-ai`: it must resolve
  into the managed release, not the npm tree. Full procedure in FORK.md.

### The free-model roster lags Zen
- The roster comes from the catalogue compiled into `pi-ai`, so `refreshModels()`
  can only remove models Zen retired, never add new ones. Neither `pi update` nor
  `pi update --models` helps. New models go in `EXTRA_FREE_MODELS` by hand.
- `~/.pi/agent/models-store.json` shadows the live roster, so adding a model
  appears to do nothing until that provider's key is deleted. Procedure in FORK.md.

### Upstream has no git tags
- The 0.1.7 base is pinned locally as `v0.1.7-pinned`. `git fetch upstream --tags`
  yields nothing useful; compare against `upstream/main` directly.

**Assumptions to avoid:**
- Never assume a 403 means auth, quota, or network. On this path it means the
  identity fingerprint, and the message is always the same.
- Never assume a single successful request means the gate is satisfied.
- Never assume the live roster reflects what Zen currently offers.
- Never assume the version in `OPENCODE_USER_AGENT` is current. It is a floor
  plus the version in use when last touched, and a stale value has not been
  observed to fail, but it will drift.

---

## 11. Implementation Notes

- This is a fork of `Aymendje/pi-opencode-direct`, base 0.1.7 (`8c359b8`,
  tagged locally `v0.1.7-pinned`). Remote `upstream` is kept fetch-only as a
  reference.
- Local divergence from upstream: the peer-dependency fix, `src/host-link.ts`
  and its import-time repair, the timestamp-encoded session id, and the
  non-self-identifying User-Agent.
- `OPENCODE_VERSION`-style freshness is not automated here. The User-Agent is a
  constant. If the gate ever starts checking the version, that constant is where
  it gets fixed.
- Pi is installed via its managed layout, not global npm. `npm root -g` does not
  locate Pi. Details in FORK.md.

---

## 12. Repository Map

**Important Files:**
| File | Purpose |
|---|---|
| `src/index.ts` | Extension entry point. First import must be `host-link.ts`. |
| `src/provider.ts` | Provider registration, model roster, Zen identity, all interception layers |
| `src/host-link.ts` | Repoints host symlinks at the running Pi release, at import time |
| `test/provider.test.ts` | Unit and wire-identity contract tests |
| `test/live.ts` | Opt-in live probe against the real free tier, never in CI |
| `FORK.md` | Host symlinks, managed install, roster refresh, verification |
| `.github/workflows/ci.yml` | `npm run verify` on Node 22 / 24 / 26 |

**Generated — never edit manually:**
| Path | Type | Regenerated by |
|---|---|---|
| `node_modules/@earendil-works/{pi-ai,pi-coding-agent}` | symlink | `src/host-link.ts` on import, or the FORK.md commands |

---

## 13. Development Commands

```bash
npm run verify          # tsc --noEmit + node:test suite + npm pack --dry-run
npm test                # unit suite only
npm run check           # typecheck only
npm run test:live       # opt-in: real requests, spends free-tier quota
```

**Verification commands** — run before claiming a task is done:

```bash
npm run verify
```

For anything touching the gate, the real proof is an end-to-end Pi call, since
unit tests cannot see the server's verdict:

```bash
pi -p --model opencode-zen-free/big-pickle --no-session "reply with exactly: pong"
```

**Common debugging:**

```bash
# See the exact identity Pi puts on the wire
PI_OPENCODE_DIRECT_DEBUG=1 pi -p --model opencode-zen-free/big-pickle --no-session "hi"

# Confirm host symlinks resolve into the managed release
realpath node_modules/@earendil-works/pi-ai

# Rebuild the model roster after editing EXTRA_FREE_MODELS (see FORK.md)
```

---

## 14. External Services

| Service | Purpose |
|---|---|
| `https://opencode.ai/zen/v1` | Free and paid model inference, gate-enforced |
| `https://opencode.ai/docs/zen` | Endpoint shape per model (the `api` field) |
| `https://models.dev/api.json` | Context limits, modalities, reasoning efforts |
| `https://registry.npmjs.org/` | `devDependencies` for CI and typecheck |

**Secrets Location:** None. The extension is keyless by design; it sends
`Authorization: Bearer public`. A Console API key may live in Pi's credential
store for the paid catalogue and is never read from this repo.

---

## 15. AI Collaboration Notes

**Implementation Style:**
- Surgical changes. This module is one file with a lot of hard-won comments; do
  not reorganize it casually.
- When touching the gate fingerprint, say what you measured and how, in the code
  comment. The next person will need to tell a working fingerprint from a
  plausible-looking one.
- Never introduce a runtime dependency. If it feels necessary, it probably belongs
  in the host.

**Communication:**
- Ask before changing the identity headers, session id scheme, or User-Agent.
  They look like noise to a reader and are load-bearing.
- Report gate behavior with repetition counts. "It 403s" and "it 403'd 5 of 5
  while a known-good replay passed 15 of 15" are different claims.

**Learning Preference:**
- The owner is comfortable with wire-level debugging. Show the request, the
  response, and the diff between them rather than a summary.

**The mistakes to flag first in this repo:**
1. Breaking the gate fingerprint: reverting the timestamp-encoded session id, or
   putting an identifying token back in the User-Agent.
2. Reverting those fixes because they look like cruft, or reinstalling from
   upstream, which reintroduces the 403.
3. Wrecking the host symlinks via `npm install` or a `pi update`.
4. Trusting a single failed (or single successful) request as a verdict.

---

## 16. Known Limitations

- The gate is enforced server-side and can change without notice. This extension
  can break overnight with no code change and no changelog entry. That is inherent
  to impersonation, not a defect to be engineered away.
- Supports Pi and OMP hosts only, since it depends on the Pi extension API.
- Only serves OpenCode Zen. Other free providers are deliberately out of scope.
- `EXTRA_FREE_MODELS` is manual, so a newly shipped Zen free model is invisible
  until both pi-ai ships a catalogue including it and the entry is removed.
- `x-opencode-project` is sent as the literal `global`. Unverified whether the
  gate reads it; recorded as untested rather than correct.

---

## Maintenance Rules

Umbrella rule: never update this file for implementation work unless it
changes durable project knowledge. (A bug fix is usually just a bug fix — but
if fixing it revealed "the gate decodes the session timestamp," that's a
gotcha, and it belongs.)

> Decisions are append-only (see §8). Never delete a decision — supersede or
> deprecate it instead.

Before touching this file, run through this checklist. If every answer is
"No," leave CONTEXT.md untouched.

- Did the architecture or a design decision change?
- Did project philosophy or a non-goal change?
- Did an architecture rule change (added, removed, or relaxed)?
- Did a coding convention change project-wide?
- Did domain knowledge get discovered or clarified?
- Did a new gotcha appear, or a wrong assumption get exposed?
- Did an implementation note change (something now mid-flight, or now resolved)?
- Did the stack, milestone, long-term direction, or external services change?
- Did a permanent limitation get added or lifted?

**Never update this file for:**
- commits
- completed tasks
- bug fixes
- refactors
- git history
- branch changes
- session summaries
- TODO lists
- transient blockers (issue tracker's job)

Git already records all of those.
