import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions, OutputFile, Plugin } from "esbuild";
import { type PreparedTools, prepareTools } from "./lib/prepare.js";
import { resolveToolSpecs } from "./lib/spec.js";
import type {
	BakedManifest,
	MisePluginOptions,
	Platform,
} from "./lib/types.js";

export type {
	BakedManifest,
	BakedTool,
	MisePluginOptions,
	Platform,
	ToolSpec,
	ToolSpecObject,
} from "./lib/types.js";

/**
 * Matches this package's manifest placeholder module, both as published
 * (`dist/manifest.js`) and inside this workspace (`src/manifest.ts`).
 * Exported so tests can pin the coupling between this regex and the build
 * output layout in tsdown.config.ts.
 */
export const MANIFEST_MODULE_PATTERN =
	/esbuild-plugin-mise[/\\](?:dist[/\\]manifest\.js|src[/\\]manifest\.ts)$/;

const DEFAULT_PLATFORMS: Platform[] = ["linux-x64", "linux-arm64"];

/** This package's runtime module, next to this file — `.js` as published, `.ts` in this workspace. */
const RUNTIME_MODULE =
	["./runtime.js", "./runtime.ts"].find((p) =>
		existsSync(fileURLToPath(new URL(p, import.meta.url))),
	) ?? "./runtime.js";

interface Prepared extends PreparedTools {
	manifest: BakedManifest;
}

/**
 * esbuild plugin that ships CLI tools alongside the bundle.
 *
 * At build time it resolves the declared tools (plugin options, falling back
 * to the project's `mise.toml`), downloads the matching release binaries for
 * each target platform into a project-local cache — never installing anything
 * on the system — and emits them under `<outdir>/<toolsDir>/<platform>/`.
 * It also bakes the resolved manifest into
 * `@neondatabase/esbuild-plugin-mise/runtime`, whose `ensureTools()` prepends
 * the right platform's tools folder to `PATH` at runtime.
 */
export function misePlugin(options: MisePluginOptions = {}): Plugin {
	return {
		name: "neon-mise",
		setup(build) {
			const cwd = build.initialOptions.absWorkingDir ?? process.cwd();
			const platforms = options.platforms ?? DEFAULT_PLATFORMS;
			const toolsDir = options.toolsDir ?? "tools";
			const cacheDir =
				options.cacheDir ??
				join(
					cwd,
					"node_modules/.cache/@neondatabase/esbuild-plugin-mise",
				);

			// One resolution per plugin instance: rebuilds (watch mode) and the
			// onLoad/onEnd hooks all await the same work.
			let prepared: Promise<Prepared> | undefined;
			const prepare = (): Promise<Prepared> => {
				const promise =
					prepared ??
					(async () => {
						const { specs, skippedReason } = await resolveToolSpecs(
							options,
							cwd,
						);
						if (skippedReason !== undefined) {
							console.info(
								`[@neondatabase/esbuild-plugin-mise] ${skippedReason} — no tools will be installed.`,
							);
						}
						const result = await prepareTools(
							specs,
							platforms,
							cacheDir,
						);
						return {
							...result,
							manifest: {
								version: 1,
								toolsDir,
								platforms,
								tools: result.tools,
							},
						};
					})();
				prepared = promise;
				// Don't memoize failures: in watch mode a transient network error on
				// one build must not poison every subsequent rebuild.
				promise.catch(() => {
					if (prepared === promise) prepared = undefined;
				});
				return promise;
			};

			// Builds that externalize bare imports (`packages: "external"` — the
			// Neon Functions bundler does this) would leave the runtime module out
			// of the bundle, so the manifest could never be baked. The runtime ships
			// in this very package, so resolve it ourselves and force it internal.
			build.onResolve(
				{ filter: /^@neondatabase\/esbuild-plugin-mise\/runtime$/ },
				() => ({
					path: fileURLToPath(
						new URL(RUNTIME_MODULE, import.meta.url),
					),
					external: false,
				}),
			);

			let manifestBaked = false;
			build.onLoad({ filter: MANIFEST_MODULE_PATTERN }, async () => {
				const { manifest } = await prepare();
				manifestBaked = true;
				return {
					contents: `export default ${JSON.stringify(manifest)};`,
					loader: "js",
				};
			});

			build.onEnd(async (result) => {
				if (result.errors.length > 0) return;

				const { files } = await prepare();
				// A missing mise config resolves to zero tools (logged above): nothing
				// to emit, nothing to validate.
				if (files.length === 0) return;

				if (
					build.initialOptions.write !== false &&
					build.initialOptions.outdir === undefined &&
					build.initialOptions.outfile === undefined
				) {
					// esbuild prints the bundle to stdout in this configuration; there
					// is no build output directory to emit the binaries next to, and
					// writing them into cwd would litter the project.
					return {
						errors: [
							{
								text: "@neondatabase/esbuild-plugin-mise requires `outdir` or `outfile` (or `write: false`) so the tool binaries have a build output to be emitted into.",
							},
						],
					};
				}

				const outBase = resolveOutBase(build.initialOptions, cwd);

				if (build.initialOptions.write === false) {
					result.outputFiles ??= [];
					for (const file of files) {
						result.outputFiles.push(
							makeOutputFile(
								join(
									outBase,
									toolsDir,
									file.platform,
									file.bin,
								),
								file.data,
							),
						);
					}
				} else {
					for (const file of files) {
						const path = join(
							outBase,
							toolsDir,
							file.platform,
							file.bin,
						);
						await mkdir(dirname(path), { recursive: true });
						await writeFile(path, file.data, { mode: 0o755 });
					}
				}

				if (!manifestBaked) {
					return {
						warnings: [
							{
								text: 'The tool manifest was not baked into any module: nothing in this build imports @neondatabase/esbuild-plugin-mise/runtime (or the package is marked external / packages: "external"). ensureTools() will be a no-op in the produced bundle.',
							},
						],
					};
				}
			});
		},
	};
}

export default misePlugin;

function resolveOutBase(options: BuildOptions, cwd: string): string {
	if (options.outdir !== undefined) return resolve(cwd, options.outdir);
	if (options.outfile !== undefined)
		return dirname(resolve(cwd, options.outfile));
	return cwd;
}

function makeOutputFile(path: string, contents: Uint8Array): OutputFile {
	return {
		path,
		contents,
		// Real content hash so consumers diffing outputFiles between rebuilds see
		// tool binaries change (esbuild populates this field for its own outputs).
		hash: createHash("sha256").update(contents).digest("hex").slice(0, 16),
		// Not part of esbuild's OutputFile: mode-aware archivers (e.g.
		// @neondatabase/config-runtime's function bundler) read this to record
		// the executable bit, which PATH lookup requires at runtime.
		mode: 0o755,
		get text() {
			return new TextDecoder().decode(contents);
		},
	} as OutputFile & { mode: number };
}
