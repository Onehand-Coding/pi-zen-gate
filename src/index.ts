// Must stay FIRST: this module relinks the host symlinks as an import-time side
// effect, and ESM evaluates imports in declaration order — so it repairs the links
// before ./provider.ts (below) resolves pi-ai. Reordering these two imports
// silently reinstates the duplicate-module bug.
import { hostModuleDrift, hostRelease } from "./host-link.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { patchCompatDirectTransport, patchGlobalFetchForZen, patchNodeHttpForZen, zenProvider } from "./provider.ts";

/** Where this package's own pi-ai symlink lands, once followed. */
function extensionModuleDir(): string | undefined {
  try {
    return realpathSync(fileURLToPath(new URL("../node_modules/@earendil-works/pi-ai", import.meta.url)));
  } catch {
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  let context: ExtensionContext | undefined;
  const remember = (_event: unknown, ctx: ExtensionContext) => { context = ctx; };
  pi.on("session_start", (event: unknown, ctx: ExtensionContext) => {
    remember(event, ctx);
    const drift = hostModuleDrift({ piEntry: process.argv[1], extensionModuleDir: extensionModuleDir() });
    if (!drift) return;
    if (!ctx.hasUI) return;
    ctx.ui.notify(drift, "warning");
    ctx.ui.setStatus("pi-zen-gate", `⚠ pi-ai drift (Pi ${hostRelease(process.argv[1])})`);
  });
  pi.on("before_agent_start", remember);
  const getSessionId = () => context?.sessionManager.getSessionId();
  pi.registerProvider(zenProvider(getSessionId));
  // Cover side-channels that bypass Models (e.g. pi-hermes-memory direct
  // transport via pi-ai/compat): same Zen identity, no per-user config.
  // Never let a side-channel patch failure break provider registration.
  try {
    patchCompatDirectTransport(getSessionId);
  } catch {
    // Main-path streaming still works; direct side-channels fall back to
    // static model/auth headers.
  }
  // Last resort: any other in-process fetch to Zen (present/future Pi flows
  // such as compaction if rerouted) still carries the identity.
  try {
    patchGlobalFetchForZen(getSessionId);
  } catch {
    // Wrappers above already cover the known paths.
  }
  // Same for non-fetch callers (axios / node-fetch style) in any extension
  // or in-process MCP tool.
  try {
    patchNodeHttpForZen(getSessionId);
  } catch {
    // Fetch-level coverage above is the common case.
  }
}
