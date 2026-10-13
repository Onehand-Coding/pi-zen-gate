# Changelog

## 0.2.0

First release under this fork's own identity (`pi-zen-gate`), diverged from
`pi-opencode-direct` 0.1.7. The version no longer tracks upstream's, because the
code no longer matches it.

### The Zen free-tier gate now passes

- **`x-opencode-session` encodes a real timestamp.** The 12 hex characters were
  derived from a sha256 hash, so they decoded to an arbitrary date (1971-10-24 on
  this machine) and every request 403'd `FreeTierError`. `timestampHex()` now
  implements the scheme from `packages/schema/src/identifier.ts`:
  `BigInt(timestamp) * 0x1000n + counter`, bitwise-inverted for session ids,
  emitted as 6 big-endian bytes of hex. The value is cached per Pi session with a
  24h max age, so affinity and `reasoning.encrypted_content` replay still work.
- **The User-Agent no longer identifies the package.** It ended in
  `pi-opencode-direct/0.1.7`; that token alone turned a passing request into a
  403. The version number was never the issue, the identity claim was.
- `requestHeader()` uses the same encoding, ascending as upstream does for
  message ids.
- The `/zen/v1/models` catalogue fetch was still sending the old self-identifying
  User-Agent. That endpoint is not gated so it was passing by luck; it now shares
  `OPENCODE_USER_AGENT` with every other Zen request.

### Host-module repair survives `pi update`

- `src/host-link.ts` repoints the host symlinks at the release Pi is actually
  running, at **import** time. ESM evaluates imports in declaration order, so
  `index.ts` must keep it as its first import; repairing at `session_start` would
  be too late, because the stale `pi-ai` is already in memory.
- `hostModuleDrift()` is the backstop for cases relinking cannot handle, and
  returns null rather than warning on something it cannot verify.

### Peer-only host dependencies

- `@earendil-works/pi-ai` and `pi-coding-agent` are declared peer-only with `"*"`.
  Upstream had `pi-ai` in both `dependencies` and `peerDependencies`, which makes
  Pi warn on every startup. Reported as
  [issue #3](https://github.com/Aymendje/pi-opencode-direct/issues/3), unanswered.

### Notes for upgraders from `pi-opencode-direct`

- The Pi provider id is still `opencode-zen-free`, so existing `models-store.json`
  rosters and `/model` selections keep working.
- Host symlinks are only needed for a local-path checkout. Installing from git or
  npm needs no manual steps.

## 0.1.7

Upstream release. Retained for history; see
`Aymendje/pi-opencode-direct`.

- Pi 0.86.1 compatibility: adapt to the `TranscriptContext` Custom Streaming API. All `stream`/`streamSimple` paths (provider wrapper and compat side-channel patch) normalize legacy `Context` (`systemPrompt`/`tools`) to transcripts via `normalizeContext`, so direct calls keep working while Pi core sends transcripts. `swapCompactionPrompt` handles both shapes — legacy `systemPrompt` and transcript system messages read via `getCurrentSystemPrompt` (tools checked via `getCurrentTools`) — still limited to short standalone summarization prompts, user message and format untouched, keyed requests never rewritten. Debug shape summaries count transcript-declared tools.
- Pin `@earendil-works/pi-ai` to `0.86.1` in dependencies and devDependencies; tests build transcript contexts the way Pi core does.
- Ignore local Pi state (`/.pi` in `.gitignore`).

## 0.1.6

- Send OpenCode's byte-identical compaction system prompt for anonymous summarization: Zen gates anonymous free tier on the developer content, so Pi's own summarization prompt 403s while OpenCode's exact text passes with otherwise identical requests (found by diffing a working vs failing capture). `swapCompactionPrompt` replaces short standalone prompts containing the summarization marker, user message and format untouched, keyed requests never rewritten.

- Always send `x-client-request-id` (same affinity value as `x-opencode-session`): Pi core compaction forces `cacheRetention: "none"`, for which pi-ai drops its own session-affinity headers downstream — and Zen 403s requests missing it while identical ones carrying it pass (found via MITM: the header is present on every other call). Set explicitly in the provider wrapper, the compat patch, and both network guards.

- Support Zen API keys with anonymous fallback: `resolveZenApiKey` prefers a stored credential (`/login opencode-zen-free`), then `OPENCODE_API_KEY`, then `public`. Wrappers rebuild `Authorization` from the effective key so it can never mismatch. Anonymous stays the default; a key moves you to account quota when the anonymous tier rejects you.

- Env-gated request logging: `PI_OPENCODE_DIRECT_DEBUG=1` logs the outbound Zen identity (UA, session, auth presence, request shape) at each layer without ever logging content.

## 0.1.5

- Last-resort fetch guard: any other in-process `fetch` to `https://opencode.ai/zen/v1` (present or future Pi flows, e.g. compaction if rerouted off the provider) gets the same identity at the network edge. Strictly scoped to the Zen base URL, preserves a valid upstream session and an existing Authorization, reload-safe via pristine-original stash.
- Same coverage for non-fetch callers: `node:http`/`https` `request`/`get` targeting `opencode.ai/zen/v1` (axios / node-fetch style code in any extension or in-process MCP tool) get the identity injected across all header shapes (object, `Headers`, pair array). Other hosts pass through untouched. Not covered: separate processes (Hermes children, MCP stdio servers calling Zen themselves), direct `undici` imports, named-import capturers bound before load, WebSocket (unused by Zen transports).

## 0.1.4

- Fix `pi-hermes-memory` background-review direct transport (`Memory auto-review failed ... FreeTierError ... can only be used from within OpenCode`): the OpenCode `User-Agent` / `x-opencode-client` / `x-opencode-project` identity now lives on `provider.headers`, `model.headers`, and `auth.resolve()` headers, not only in the `stream()`/`streamSimple()` wrapper. Side-channels that use `modelRegistry.getApiKeyAndHeaders()` + `pi-ai/compat completeSimple` (which never call the wrapper) now pass the gate. Dynamic `x-opencode-session` / `x-opencode-request` / `Authorization` stay per-request in the wrapper.
- Zero-config memory side-channels: the extension also patches the global `pi-ai/compat` API registry at load so `completeSimple`/`streamSimple` calls that bypass Models send the full dynamic Zen identity (`Bearer public`, OpenCode `User-Agent` / `x-opencode-client` / `x-opencode-project`, per-session `x-opencode-session`, per-request `x-opencode-request`, encrypted-content fetch retry) for `opencode-zen-free` models only. No `llmModelOverride` / `childExtensionPaths` needed for the default direct transport. Deliberately no `xhigh` default on this path: compat omission stays `off`, preserving `llmThinkingOverride: off`. Reload-safe via pristine-original stash (no wrapper stacking).
- Note: the Hermes `pi -p` subprocess transport still spawns with `--no-extensions` + only Hermes loaded, so `opencode-zen-free/... not found` there needs `"childExtensionPaths": ["/path/to/pi-opencode-direct/src/index.ts"]` in `hermes-memory-config.json` — only relevant when direct fails or `reviewTransport` is forced to `subprocess`.

## 0.1.3

- Recover from OpenCode's free-tier `from within OpenCode` gate: send `Authorization: Bearer public`, the exact OpenCode `User-Agent` / `x-opencode-client` / `x-opencode-project` / `x-opencode-request` headers, and a structurally valid `ses_` session id (`12` hex + `14` base62) with a matching `prompt_cache_key`.

## 0.1.2

- Declare `@earendil-works/pi-ai` as a real dependency (pinned to the validated Pi) instead of peer-only. Pi installs with `--legacy-peer-deps`, which never auto-installs peers, so on machines where no sibling extension provides `pi-ai` the extension failed to load with `Cannot find module ... openai-completions.lazy`.

## 0.1.1

- Recover long sessions when Zen rotates backends: retry once without replayed `reasoning.encrypted_content` on `was not issued to this caller` / `could not be verified` 400s, dropping orphaned function-call ids to avoid pairing validation.

## 0.1.0

- Connect Pi directly to OpenCode Zen's anonymous free tier.
- Support Muse Spark images, configurable thinking, streaming, and native tool calls.
- Register other known free models through Pi's native Chat Completions transport.
- Refresh available models against Zen's public catalogue while retaining Pi's model metadata.
- Keep session routing stable without sending API credentials.
