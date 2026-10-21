# pi-zen-gate

Free OpenCode Zen models in Pi through native HTTP requests. No OpenCode
installation, login, API key, server, container, or LiteLLM is required.

> **This is a fork of [`Aymendje/pi-opencode-direct`](https://github.com/Aymendje/pi-opencode-direct)**
> (MIT), maintained here because upstream's latest release no longer passes the Zen
> free-tier gate. Upstream remains the origin and is credited as such; see
> [FORK.md](https://github.com/Onehand-Coding/pi-zen-gate/blob/main/FORK.md) for
> exactly what diverges and
> [CONTEXT.md](https://github.com/Onehand-Coding/pi-zen-gate/blob/main/CONTEXT.md)
> for the durable project knowledge. Neither file ships in the tarball, so they
> are linked from the repository rather than bundled.

## Install

Requires Pi 0.85.1 or newer (tested with 0.85.1) and Node 22.19 or newer.

```sh
pi install git:github.com/Onehand-Coding/pi-zen-gate
```

For development, run `npm ci --ignore-scripts` followed by `pi install .`
from a checkout of this repository. The dev dependencies needed by the native
transport imports must be resolvable when running from a checkout.

Restart Pi or use `/reload`, then select **OpenCode Zen Free** in `/model`.

```sh
pi --provider opencode-zen-free --model big-pickle
```

Big Pickle supports native tool calls and chat transport. Muse Spark, the
former xhigh-reasoning default, is retired upstream (410 ModelDeprecated) and
is dropped from the roster on refresh. The provider also registers the other
free models supported by Pi's
Chat Completions transport. Their capabilities and limits come from Pi's
built-in OpenCode catalogue rather than guessed defaults.

## How it works

The extension adds a separate `opencode-zen-free` provider. It uses Pi's native
Responses transport for Muse Spark and native Chat Completions for the other
supported free models. Native Pi streaming handles text, thinking, tool-call
arguments, usage, aborts, and tool-result replay. Tools execute through Pi.

Requests are anonymous by default: without any configured key the literal
`public` bearer is used and no credentials are sent. If the anonymous tier
rejects you (`FreeTierError ... within OpenCode` on every request, even tiny
ones — upstream gates anonymous access by more than headers, e.g. egress IP
reputation), attach a Zen key instead: `/login opencode-zen-free`, or set
`OPENCODE_API_KEY`. Priority is stored credential, then `OPENCODE_API_KEY`,
then anonymous; an explicitly passed `--api-key` is honored the same way.

Anonymous summarization additionally sends OpenCode's byte-identical compaction
system prompt instead of Pi's: Zen gates anonymous free tier on that developer
content (identical requests with Pi's text 403, with OpenCode's text pass). Only
short standalone summarization prompts are rewritten, never conversation content
or keyed requests.

Anonymous quota is shared per egress IP (server-side trial bucket counting input +
output + reasoning tokens), so heavy anonymous traffic from one IP — large Hermes
reviews, compactions, or many clients behind one NAT/egress proxy — can exhaust
it for everyone behind that IP with `FreeTierError`, while the genuine CLI from
a fresh IP keeps working. If anonymous fails everywhere at once, wait for the
window to reset and move heavy background work to a keyed model; light chat
spends little. Set `PI_OPENCODE_DIRECT_DEBUG=1` to log outbound identity.
A hash of Pi's session ID supplies `x-opencode-session`, keeping
routing affinity stable across turns and distinct between sessions. Auxiliary
calls use the active Pi session when no explicit session ID is available.

A bounded public-catalogue refresh intersects the currently listed IDs with
Pi's known zero-cost models. Unknown models and paid models are not registered.
Pi's model cache is used offline, with the bundled catalogue as the initial
fallback. Update Pi for newly added model metadata. Free-model availability
and limits can change upstream; there is no automatic paid fallback.

Requests use Pi's native retry handling (two retries by default) and a
180-second per-request timeout. Caller overrides and cancellation are honored.
Muse Spark currently accepts only `tool_choice: auto`; normal Pi tool use does
not require forced tool choice.

## Route through opencode-unlimited-proxy (optional)

[`opencode-unlimited-proxy`](https://github.com/ebouther/opencode-unlimited-proxy)
is a separate self-hosted gateway (Linux and Docker required) that serves the
same free models through an OpenAI-compatible API and rotates egress addresses.
Pi can use it without any change to this extension: override the provider's
base URL in `<agent-dir>/models.json` (`~/.pi/agent/models.json` by default).
OpenCode can use the same gateway through the toggle script below; that path is
opt-in so its direct `opencode/` models remain an independent fallback.

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "opencode-zen-free": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "apiKey": "local-test-key"
    }
  }
}
```

The key must match `server_keys` in the gateway's `stack/config.json`
(`local-test-key` is the shipped default). Reload Pi or restart it, then use
the same model IDs as before:

```sh
pi --provider opencode-zen-free --model big-pickle
```

Inference now goes to the gateway, which rebuilds the OpenCode fingerprint and
forwards through its proxy pool. The extension's own gate headers still travel
with the request; the gateway does not depend on them. Roster refresh still
reads Zen's public catalogue directly (`/inference/v1/models`, metadata only),
so only inference is routed through the gateway. `models-store.json` needs no
edit: the override is applied above the cached roster, and the cached
`baseUrl` values may keep pointing at Zen even while requests go to the
gateway.

Caveats:

- The gateway must be running. If it is down, requests fail; there is no
  fallback to the direct Zen endpoint.
- A stored credential from `/login opencode-zen-free` takes priority over the
  `models.json` `apiKey`. Run `/logout opencode-zen-free` if one exists.
- The override covers the whole provider, so direct and proxied access cannot
  run side by side under the same provider ID.
- Quota remains finite per egress address. The gateway widens it; it does not
  remove it. Keep the listener on loopback, change its default server key, and
  review its README and OpenCode's terms before relying on it.

### Toggle script

`scripts/pi-zen-proxy` wraps both sides of the switch. Run it from a checkout,
or put it on `PATH` once:

```sh
ln -s "$PWD/scripts/pi-zen-proxy" ~/.local/bin/pi-zen-proxy
```

```sh
pi-zen-proxy on                     # Pi only; OpenCode stays direct
pi-zen-proxy on --agent opencode    # OpenCode only
pi-zen-proxy on --agent both        # both
pi-zen-proxy off                    # restore both, then stop the containers
pi-zen-proxy status                 # mode for both, container state, gateway health
```

`on` defaults to `pi` so OpenCode keeps its independent direct free tier as a
fallback when Pi's quota is exhausted. `off` defaults to `both` and is
idempotent. `--agent pi` or `--agent opencode` narrows either command. The
gateway is stopped only when no agent is left proxied, so `off --agent pi`
leaves it running for an active OpenCode override.

For Pi, the script reads the listen address and first `server_keys` entry from
`stack/config.json` and edits only the `opencode-zen-free` entry, so other
`models.json` providers survive. Override the defaults with
`PI_ZEN_PROXY_STACK`, `PI_ZEN_PROXY_URL`, `PI_ZEN_PROXY_KEY`,
`PI_ZEN_PROXY_WAIT_SECONDS`, or `PI_CODING_AGENT_DIR`. Reload Pi after `on` or
`off`.

For OpenCode, the script generates a proxy copy of the global config, adds the
`opencode-unlimited-proxy` provider with the gateway's live model list, and
swaps the global config symlink to it. `off` restores the original link (or a
regular file from its `.pi-zen-proxy.bak` copy) and removes the generated
config. Restart OpenCode after `on` or `off`, then select
`opencode-unlimited-proxy/<model>`. The existing `opencode/<model>` entries
remain available unless you switch models. The generated file contains the
gateway's server key; it stays in the OpenCode config directory, not in this
repo.

The OpenCode config is read as JSONC, so comments survive in the source but
not in the generated proxy copy. Edit the ai-workbench source
(`configs/opencode.json`) rather than the live symlink while the proxy is on;
the live path points at the generated file. `OPENCODE_CONFIG` overrides the
global config path (default `~/.config/opencode/opencode.json`).

Remove the `opencode-zen-free` entry (or the whole file) and reload to return
Pi to direct Zen access. `pi-zen-proxy off` does the same and also restores
OpenCode.

## Memory extensions (pi-hermes-memory)

Background-review direct transport (`pi-ai/compat completeSimple`) bypasses
the `stream()` wrapper, so this extension patches the global compat registry
at load: `opencode-zen-free` models get the full dynamic identity there too
(`Bearer public`, OpenCode `User-Agent` / `x-opencode-client` / `project` /
per-session full correlation set (`x-opencode-session` /
`x-opencode-session-id` / `x-session-affinity` / `x-session-id`), plus the
encrypted-content retry), while other providers pass through untouched. No
memory config needed for the default direct transport — and compat omission
stays `off`, preserving Hermes `llmThinkingOverride: off` (no forced `xhigh`
on this path).

As a last resort, a fetch guard scoped strictly to `https://opencode.ai/inference/v1`
adds the same identity at the network edge for any other in-process path
(Pi core flows such as compaction, present or future) — other hosts pass
through untouched, and a valid upstream session / existing Authorization are
preserved. `node:http`/`https` callers (axios / node-fetch style, any extension
or in-process MCP tool) get the same treatment. Separate processes, direct
`undici` imports, and WebSocket are the only gaps — Zen transports are
fetch/SSE, so those don't apply in practice.

The `pi -p --no-session` subprocess transport is a separate process, so no
in-process patch can cover it: it loads `--no-extensions` + Hermes only and
cannot see `opencode-zen-free` on its own. That path only runs when direct
fails (or `reviewTransport` is forced to `subprocess`), so with direct fixed
no config is needed. If you force subprocess, expose this package to the
child with an absolute file path:

```json
{
  "childExtensionPaths": ["/path/to/pi-zen-gate/src/index.ts"]
}
```

## Development

```sh
npm ci --ignore-scripts
npm run verify

# Optional: sends real requests to Zen
npm run test:live
```

`npm test` uses in-memory HTTP fixtures, with no network or model calls.
`test:live` is opt-in and sends two small free-tier requests to verify images,
xhigh reasoning, native streaming tool calls, and replay of a tool result.
Use the free tier lightly and follow the provider's data-use policies.

Validated with Pi 0.85.1: seven automated tests; live image recognition with a
native tool-call/result round trip; and a Pi CLI session that used `read` on a
PNG and correctly described it while OpenCode was absent from `PATH`.

`npm run verify` runs type checking, fixture tests, and an npm package dry run.
CI runs these checks on Node 22, 24, and 26. See [FORK.md](FORK.md)
for release steps and [CHANGELOG.md](CHANGELOG.md) for changes.

## License

MIT. This is an independent extension, not an official OpenCode or Pi package.
