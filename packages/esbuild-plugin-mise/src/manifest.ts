import type { BakedManifest } from "./lib/types.js";

/**
 * Placeholder swapped out at the consumer's build time: when their bundle is
 * built with the esbuild plugin, an `onLoad` hook replaces this module with the
 * resolved tool manifest. When the runtime is used *without* the plugin (plain
 * `node`, a bundler that doesn't run the plugin), it resolves to `null` and
 * `ensureTools()` becomes a no-op.
 *
 * The value is read through `globalThis` rather than written as a `null`
 * literal: this package's own build (and consumer bundlers when the plugin
 * isn't active) would otherwise const-fold the literal into runtime.js,
 * disconnecting it from this module and breaking the build-time substitution.
 * The global doubles as an escape hatch for hosts that want to inject a
 * manifest without rebuilding.
 */
const manifest: BakedManifest | null =
	(globalThis as { __neonEsbuildPluginMiseManifest?: BakedManifest })
		.__neonEsbuildPluginMiseManifest ?? null;

export default manifest;
