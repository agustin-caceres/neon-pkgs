import { basename, relative, sep } from "node:path";
import {
	ErrorCode,
	PlatformError,
	type ResolvedFunctionConfig,
} from "@neondatabase/config";
// Type-only — erased at compile time, so esbuild still never enters this
// package's static module graph (see the note on dynamic imports below).
import type { Plugin } from "esbuild";

/**
 * Builds the deployable ZIP bundle for a single function. The default
 * implementation ({@link buildFunctionBundle}) shells out to esbuild, but
 * `pushConfig` / `apply` accept a custom bundler so a consumer that can't ship
 * esbuild's native binary (e.g. a single-file CLI) can supply its own — a WASM
 * build, an esbuild binary on PATH, etc. — without this package dragging esbuild
 * into their bundle.
 */
export type FunctionBundler = (
	fn: ResolvedFunctionConfig,
) => Promise<Uint8Array>;

export interface BuildFunctionBundleOptions {
	/**
	 * Additional esbuild plugins to run during the bundle build, after the
	 * built-in ones. Wire this in via a custom {@link FunctionBundler}:
	 * `(fn) => buildFunctionBundle(fn, { plugins: [...] })`.
	 */
	plugins?: Plugin[];
}

/**
 * Users opt into shipping CLI tools with their function by dropping this file
 * (mise `[tools]` format) next to their `neon.ts`. The bundler always passes it
 * to `@neondatabase/esbuild-plugin-mise`; when the file is absent the plugin
 * logs an info and bundles no tools. Deliberately not the project's `mise.toml`:
 * that usually declares language runtimes (node, pnpm, …) the plugin rejects.
 */
const NEON_MISE_CONFIG = "neon.mise.toml";

/**
 * Build the deployable bundle (a ZIP archive of the esbuild-bundled source) for a function.
 *
 * This is the **imperative shell** step of function deploys, and the reason it lives in
 * `@neondatabase/config-runtime` rather than `@neondatabase/config`: it pulls in `esbuild`
 * (a native binary) and `fflate`. Keeping it out of `@neondatabase/config` means a `neon.ts`
 * that only imports `defineConfig` never drags esbuild into the user's dependency tree or
 * bundle. Deploy-side consumers (the neonctl CLI, CI) import this package and get esbuild as
 * a normal, auto-installed dependency.
 *
 * esbuild and fflate are loaded with a dynamic `import()` (not a static top-level import) so
 * that nothing in this package's static graph names esbuild until a deploy actually runs —
 * a second layer of protection on top of the package split.
 *
 * Mirrors: `esbuild <source> --bundle --outfile=index.mjs --sourcemap --minify`, then zips
 * the emitted files into the archive the Functions deploy endpoint expects. Output paths are
 * archived relative to the build output root (so plugin-emitted files like `tools/<platform>/rg`
 * keep their layout), and unix file modes are recorded in the archive — plugins may attach a
 * `mode` property to the `OutputFile`s they append (as `@neondatabase/esbuild-plugin-mise`
 * does for executables); everything else is archived as a regular `0644` file.
 *
 * CLI tools: the build always runs `@neondatabase/esbuild-plugin-mise` pointed at
 * `neon.mise.toml` in the working directory. Users who want CLIs available to their function
 * (via `ensureTools()` from `@neondatabase/esbuild-plugin-mise/runtime`) declare them there;
 * without the file the plugin logs an info and ships no tools.
 */
export async function buildFunctionBundle(
	fn: ResolvedFunctionConfig,
	options: BuildFunctionBundleOptions = {},
): Promise<Uint8Array> {
	const esbuild = await loadEsbuild();
	const { misePlugin } = await loadMisePlugin();

	let result: Awaited<ReturnType<typeof esbuild.build>>;
	try {
		result = await esbuild.build({
			entryPoints: [fn.source],
			bundle: true,
			write: false,
			// Emit `index.mjs` / `index.mjs.map`: the Functions runtime imports the archive's
			// entry by the conventional `index.{js,mjs}` name, and `.mjs` makes Node load the
			// ESM output directly. (With `write: false` and no outfile, esbuild would label the
			// buffer `<stdout>`.)
			outfile: "index.mjs",
			sourcemap: true,
			minify: true,
			format: "esm",
			platform: "node",
			// The Functions runtime provides Node built-ins; don't try to bundle them.
			packages: "external",
			logLevel: "silent",
			plugins: [
				misePlugin({ configFile: NEON_MISE_CONFIG }),
				...(options.plugins ?? []),
			],
		});
	} catch (cause) {
		throw new PlatformError(
			ErrorCode.InvalidConfig,
			[
				`Failed to bundle function "${fn.slug}" from ${fn.source}.`,
				(cause as Error)?.message ?? String(cause),
			].join(" "),
			{ cause },
		);
	}

	// esbuild resolved the relative `outfile` against its working directory
	// (cwd), so output paths are archived relative to cwd to preserve layout.
	const outBase = process.cwd();
	const entries: Record<string, [Uint8Array, { os: number; attrs: number }]> =
		{};
	// `write: false` guarantees `outputFiles`, but the type is optional — guard for safety.
	for (const file of result.outputFiles ?? []) {
		const rel = relative(outBase, file.path);
		const name = rel.startsWith("..")
			? basename(file.path)
			: rel.split(sep).join("/");
		const mode = (file as { mode?: number }).mode ?? 0o644;
		entries[name] = [
			file.contents,
			// External attributes for os 3 (Unix): full st_mode in the high 16 bits.
			{ os: 3, attrs: ((0o100000 | mode) << 16) >>> 0 },
		];
	}

	return zipBundle(entries);
}

async function zipBundle(
	entries: Record<string, [Uint8Array, { os: number; attrs: number }]>,
): Promise<Uint8Array> {
	const { zipSync } = await loadFflate();
	return zipSync(entries, { level: 6 });
}

async function loadEsbuild(): Promise<typeof import("esbuild")> {
	try {
		return await import("esbuild");
	} catch (cause) {
		throw new PlatformError(
			ErrorCode.InvalidConfig,
			[
				"Deploying Neon Functions requires `esbuild`, which could not be loaded.",
				"It is a dependency of @neondatabase/config-runtime — reinstall your dependencies (`pnpm install` / `npm install`).",
			].join(" "),
			{ cause },
		);
	}
}

async function loadMisePlugin(): Promise<
	typeof import("@neondatabase/esbuild-plugin-mise")
> {
	try {
		return await import("@neondatabase/esbuild-plugin-mise");
	} catch (cause) {
		throw new PlatformError(
			ErrorCode.InvalidConfig,
			[
				"Deploying Neon Functions requires `@neondatabase/esbuild-plugin-mise`, which could not be loaded.",
				"It is a dependency of @neondatabase/config-runtime — reinstall your dependencies (`pnpm install` / `npm install`).",
			].join(" "),
			{ cause },
		);
	}
}

async function loadFflate(): Promise<typeof import("fflate")> {
	try {
		return await import("fflate");
	} catch (cause) {
		throw new PlatformError(
			ErrorCode.InvalidConfig,
			[
				"Deploying Neon Functions requires `fflate`, which could not be loaded.",
				"It is a dependency of @neondatabase/config-runtime — reinstall your dependencies (`pnpm install` / `npm install`).",
			].join(" "),
			{ cause },
		);
	}
}
