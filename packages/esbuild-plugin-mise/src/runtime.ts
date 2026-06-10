/**
 * Runtime companion to the esbuild plugin. Import from
 * `@neondatabase/esbuild-plugin-mise/runtime` — this module pulls in no plugin
 * code (esbuild, resolution, downloads), so the deployed bundle only carries
 * what's below.
 */
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
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
	/**
	 * Writable directory to stage the binaries into. Defaults to a
	 * manifest-keyed folder under `os.tmpdir()`, so repeat calls (and warm
	 * reuses of the same instance) skip the copy.
	 */
	destDir?: string;
	/** Environment to mutate. Defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
}

export interface EnsureToolsResult {
	/** The directory that was prepended to `PATH`. */
	binDir: string;
	tools: BakedTool[];
}

let memo: Promise<EnsureToolsResult | null> | undefined;

/**
 * Make the tools shipped by the esbuild plugin available on `PATH`.
 *
 * Copies the current platform's binaries out of the (possibly read-only)
 * bundle directory into a writable folder, marks them executable, and prepends
 * that folder to `process.env.PATH` — after this resolves, `rg`, `jq`, etc.
 * work from any child process. Call it once at module top level so the work
 * happens during instance initialization rather than on the request path.
 *
 * Memoized: concurrent and repeat calls share one install (options of the
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
		// Don't memoize failures: a transient staging error (e.g. tmpdir full)
		// should be retryable on the next call once the condition clears.
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

	const platform = `${process.platform}-${process.arch}` as Platform;
	if (!baked.platforms.includes(platform)) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: no tools were bundled for ${platform} (bundled: ${baked.platforms.join(", ")}). Add it to the plugin's \`platforms\` option and rebuild.`,
		);
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
	const srcDir = join(bundleDir, baked.toolsDir, platform);
	const key = createHash("sha256")
		.update(JSON.stringify({ platform, tools: baked.tools }))
		.digest("hex")
		.slice(0, 16);
	const destDir = options.destDir ?? join(tmpdir(), `neon-tools-${key}`);

	if (!(await isDirectory(destDir))) {
		await stage(srcDir, destDir, baked.tools, baked.toolsDir);
	}

	prependToPath(destDir, options.env ?? process.env);
	return { binDir: destDir, tools: baked.tools };
}

/**
 * Copy the binaries into place via a staging dir + atomic rename, so a
 * concurrent process either sees no `destDir` or a complete one — never a
 * half-written set of tools.
 */
async function stage(
	srcDir: string,
	destDir: string,
	tools: BakedTool[],
	toolsDir: string,
): Promise<void> {
	const staging = `${destDir}.staging-${process.pid}-${Math.random().toString(36).slice(2)}`;
	await mkdir(staging, { recursive: true });
	try {
		for (const tool of tools) {
			const src = join(srcDir, tool.bin);
			const dest = join(staging, tool.bin);
			try {
				await copyFile(src, dest);
			} catch (cause) {
				throw new Error(
					`@neondatabase/esbuild-plugin-mise: tool binary not found at ${src}. Was the bundle built with the plugin and deployed with its "${toolsDir}" folder intact?`,
					{ cause },
				);
			}
			await chmod(dest, 0o755);
		}
		await rename(staging, destDir);
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		// Lost the rename race to another process? Their copy is complete — use it.
		if (await isDirectory(destDir)) return;
		throw error;
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

function prependToPath(dir: string, env: NodeJS.ProcessEnv): void {
	const current = env.PATH ?? "";
	if (current.split(delimiter).includes(dir)) return;
	env.PATH = current ? `${dir}${delimiter}${current}` : dir;
}
