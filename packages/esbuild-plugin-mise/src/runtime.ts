/**
 * Runtime companion to the esbuild plugin. Import from
 * `@neondatabase/esbuild-plugin-mise/runtime` — this module pulls in no plugin
 * code (esbuild, resolution, downloads), so the deployed bundle only carries
 * what's below.
 */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BakedManifest, BakedTool, Platform } from "./lib/types.js";
import manifest from "./manifest.js";

export type { BakedManifest, BakedTool, Platform } from "./lib/types.js";

export interface EnsureToolsOptions {
	/**
	 * Directory containing the `<toolsDir>/<platform>/` folders emitted at build
	 * time. Defaults to the bundle's own directory — override when the tools
	 * folder is emitted somewhere else (e.g. code-split chunks in a subfolder).
	 */
	bundleDir?: string;
	/** Environment to mutate. Defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
}

export interface EnsureToolsResult {
	/** The directory that was prepended to `PATH`; `null` when the build shipped no tools. */
	binDir: string | null;
	tools: BakedTool[];
}

let memo: Promise<EnsureToolsResult | null> | undefined;

/**
 * Make the tools shipped by the esbuild plugin available on `PATH`.
 *
 * Verifies the bundled binaries are present and executable, then prepends the
 * bundle's `tools/<platform>/` folder to `process.env.PATH` — after this
 * resolves, `rg`, `jq`, etc. work from any child process. Call it once at
 * module top level so the check happens during instance initialization rather
 * than on the request path.
 *
 * Memoized: concurrent and repeat calls share one result (options of the
 * first call win). Returns `null` when the bundle wasn't built with the
 * plugin, so code stays runnable in environments where the tools come from
 * elsewhere (e.g. local dev with a real mise on PATH).
 */
export function ensureTools(
	options?: EnsureToolsOptions,
): Promise<EnsureToolsResult | null> {
	if (memo === undefined) {
		const promise = installTools(manifest, options);
		memo = promise;
		// Don't memoize failures: a transient error should be retryable on the
		// next call once the condition clears.
		promise.catch(() => {
			if (memo === promise) memo = undefined;
		});
	}
	return memo;
}

/**
 * The unmemoized worker behind {@link ensureTools}. Exposed for callers that
 * manage their own lifecycle (and for tests).
 */
export async function installTools(
	baked: BakedManifest | null,
	options: EnsureToolsOptions = {},
): Promise<EnsureToolsResult | null> {
	if (baked === null) {
		process.emitWarning(
			"ensureTools() is a no-op: this bundle was not built with @neondatabase/esbuild-plugin-mise, so no tool manifest is baked in.",
		);
		return null;
	}
	if (baked.version !== 1) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: unsupported manifest version ${String(baked.version)} — this runtime understands version 1.`,
		);
	}
	// The build ran without a mise config (or with an empty [tools] section):
	// nothing to put on PATH.
	if (baked.tools.length === 0) {
		return { binDir: null, tools: [] };
	}

	const platform = `${process.platform}-${process.arch}` as Platform;
	if (!baked.platforms.includes(platform)) {
		// Running a deploy-targeted bundle on another machine — typically a local
		// smoke-test of a linux-targeted build on a mac, where the tools are
		// expected to come from the developer's own setup (e.g. a real mise).
		// Leave PATH alone instead of failing; if this is a misconfigured deploy
		// target, the warning names the fix.
		process.emitWarning(
			`ensureTools() is a no-op: no tools were bundled for ${platform} (bundled: ${baked.platforms.join(", ")}). Locally, tools are expected on PATH already; for a deploy target, add ${platform} to the plugin's \`platforms\` option and rebuild.`,
		);
		return null;
	}

	let bundleDir = options.bundleDir;
	if (bundleDir === undefined) {
		// esbuild replaces `import.meta` with an empty object in CJS output, so
		// the bundle can't locate itself there.
		if (typeof import.meta.url !== "string") {
			throw new Error(
				"@neondatabase/esbuild-plugin-mise: cannot locate the bundle directory — import.meta.url is unavailable (CommonJS output?). Bundle to ESM, or pass `bundleDir` explicitly.",
			);
		}
		bundleDir = dirname(fileURLToPath(import.meta.url));
	}
	const binDir = join(bundleDir, baked.toolsDir, platform);

	for (const tool of baked.tools) {
		const bin = join(binDir, tool.bin);
		try {
			await access(bin, constants.X_OK);
		} catch {
			const exists = await access(bin, constants.F_OK).then(
				() => true,
				() => false,
			);
			throw new Error(
				exists
					? `@neondatabase/esbuild-plugin-mise: ${bin} exists but is not executable — the deploy pipeline stripped its file mode. Deploy with a bundler that records unix modes (e.g. @neondatabase/config-runtime's function bundler).`
					: `@neondatabase/esbuild-plugin-mise: tool binary not found at ${bin}. Was the bundle built with the plugin and deployed with its "${baked.toolsDir}" folder intact?`,
			);
		}
	}

	prependToPath(binDir, options.env ?? process.env);
	return { binDir, tools: baked.tools };
}

function prependToPath(dir: string, env: NodeJS.ProcessEnv): void {
	const current = env.PATH ?? "";
	if (current.split(delimiter).includes(dir)) return;
	env.PATH = current ? `${dir}${delimiter}${current}` : dir;
}
