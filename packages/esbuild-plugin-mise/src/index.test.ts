import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { makeTar } from "../test-helpers/tar.js";
import { MANIFEST_MODULE_PATTERN, misePlugin } from "./index.js";

const MANIFEST_MODULE = fileURLToPath(
	new URL("./manifest.ts", import.meta.url),
);
const DIST_RUNTIME = fileURLToPath(
	new URL("../dist/runtime.js", import.meta.url),
);

const TARBALL = gzipSync(
	makeTar([
		{
			name: "mytool-1.0.0/bin/mytool",
			data: new TextEncoder().encode("ELF!"),
			mode: 0o755,
		},
	]),
);

const RELEASE = {
	tag_name: "v1.0.0",
	assets: [
		{
			name: "mytool-1.0.0-aarch64-unknown-linux-musl.tar.gz",
			browser_download_url: "https://dl.example/mytool-arm64.tar.gz",
		},
		{
			name: "mytool-1.0.0-x86_64-unknown-linux-musl.tar.gz",
			browser_download_url: "https://dl.example/mytool-x64.tar.gz",
		},
	],
};

function stubFetch() {
	const impl = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (
			url.includes(
				"api.github.com/repos/acme/mytool/releases/tags/v1.0.0",
			)
		) {
			return new Response(JSON.stringify(RELEASE), { status: 200 });
		}
		if (url.startsWith("https://dl.example/mytool-")) {
			return new Response(Uint8Array.from(TARBALL), { status: 200 });
		}
		return new Response("not found", { status: 404 });
	});
	vi.stubGlobal("fetch", impl);
	return impl;
}

const ENTRY = `
import manifest from ${JSON.stringify(MANIFEST_MODULE)};
export { manifest };
`;

describe("misePlugin", () => {
	it("bakes the manifest and appends tool binaries to outputFiles (write: false)", async () => {
		stubFetch();
		const cacheDir = await mkdtemp(join(tmpdir(), "neon-mise-cache-"));

		const result = await build({
			stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: "ts" },
			bundle: true,
			write: false,
			format: "esm",
			outfile: "index.mjs",
			plugins: [
				misePlugin({
					tools: { "ubi:acme/mytool": "1.0.0" },
					platforms: ["linux-x64", "linux-arm64"],
					cacheDir,
				}),
			],
		});

		const paths = result.outputFiles.map((f) => f.path);
		expect(paths.filter((p) => p.includes("tools"))).toEqual([
			expect.stringMatching(/tools[/\\]linux-x64[/\\]mytool$/),
			expect.stringMatching(/tools[/\\]linux-arm64[/\\]mytool$/),
		]);
		const tool = result.outputFiles.find((f) =>
			f.path.includes("linux-arm64"),
		);
		expect(new TextDecoder().decode(tool?.contents)).toBe("ELF!");

		const bundle = result.outputFiles.find((f) =>
			f.path.endsWith("index.mjs"),
		);
		expect(bundle?.text).toMatch(/"toolsDir":\s*"tools"/);
		expect(bundle?.text).toMatch(/"name":\s*"ubi:acme\/mytool"/);
		expect(bundle?.text).toMatch(/"version":\s*"1\.0\.0"/);
		expect(bundle?.text).toMatch(/"bin":\s*"mytool"/);
	});

	it("writes executable binaries into the outdir (write: true) and reuses the cache offline", async () => {
		const fetchImpl = stubFetch();
		const cacheDir = await mkdtemp(join(tmpdir(), "neon-mise-cache-"));
		const outdir = await mkdtemp(join(tmpdir(), "neon-mise-out-"));

		const options = {
			tools: { "ubi:acme/mytool": "1.0.0" } as const,
			platforms: ["linux-arm64"] as const,
			cacheDir,
		};
		await build({
			stdin: { contents: "export {};", resolveDir: process.cwd() },
			bundle: true,
			outdir,
			plugins: [
				misePlugin({ ...options, platforms: [...options.platforms] }),
			],
		});

		const binPath = join(outdir, "tools", "linux-arm64", "mytool");
		expect(await readFile(binPath, "utf8")).toBe("ELF!");
		if (process.platform !== "win32") {
			expect((await stat(binPath)).mode & 0o111).not.toBe(0);
		}

		// Pinned release metadata and extracted binaries are disk-cached: a fresh
		// build with no network must still succeed.
		fetchImpl.mockRejectedValue(new Error("offline"));
		const outdir2 = await mkdtemp(join(tmpdir(), "neon-mise-out-"));
		await build({
			stdin: { contents: "export {};", resolveDir: process.cwd() },
			bundle: true,
			outdir: outdir2,
			plugins: [
				misePlugin({ ...options, platforms: [...options.platforms] }),
			],
		});
		expect(
			await readFile(
				join(outdir2, "tools", "linux-arm64", "mytool"),
				"utf8",
			),
		).toBe("ELF!");
	});

	// Pins the full mechanism end-to-end, including the manifest staying a live
	// import in the runtime module: if a bundler ever const-folds the placeholder
	// `null` into runtime.js again, ensureTools() returns null and this fails.
	it.skipIf(process.platform === "win32")(
		"produces a bundle whose ensureTools() puts a working tool on PATH",
		async () => {
			const platform = `${process.platform}-${process.arch}` as const;
			const script = `#!/bin/sh\necho hello-from-fakebin\n`;
			const tarball = gzipSync(
				makeTar([
					{
						name: "pkg/bin/mytool",
						data: new TextEncoder().encode(script),
						mode: 0o755,
					},
				]),
			);
			vi.stubGlobal(
				"fetch",
				vi.fn(async (input: string | URL | Request) => {
					const url = String(input);
					if (url.includes("releases/tags/v1.0.0")) {
						return new Response(
							JSON.stringify({
								tag_name: "v1.0.0",
								assets: [
									{
										name: `mytool-1.0.0-${platform}.tar.gz`,
										browser_download_url:
											"https://dl.example/e2e.tar.gz",
									},
								],
							}),
							{ status: 200 },
						);
					}
					return new Response(Uint8Array.from(tarball), {
						status: 200,
					});
				}),
			);

			const cacheDir = await mkdtemp(join(tmpdir(), "neon-mise-cache-"));
			const outdir = await mkdtemp(join(tmpdir(), "neon-mise-out-"));
			const destDir = join(
				await mkdtemp(join(tmpdir(), "neon-mise-dest-")),
				"staged",
			);
			const runtimeModule = fileURLToPath(
				new URL("./runtime.ts", import.meta.url),
			);
			await build({
				stdin: {
					contents: `
						import { ensureTools } from ${JSON.stringify(runtimeModule)};
						import { execFileSync } from "node:child_process";
						const result = await ensureTools({ destDir: ${JSON.stringify(destDir)} });
						if (result === null) throw new Error("manifest was not baked in");
						console.log(execFileSync("mytool", { encoding: "utf8" }).trim());
					`,
					resolveDir: process.cwd(),
					loader: "ts",
				},
				bundle: true,
				format: "esm",
				platform: "node",
				outfile: join(outdir, "index.mjs"),
				plugins: [
					misePlugin({
						tools: {
							mytool: { ubi: "acme/mytool", version: "1.0.0" },
						},
						platforms: [platform as never],
						cacheDir,
					}),
				],
			});

			const { execFileSync } = await import("node:child_process");
			const stdout = execFileSync(
				process.execPath,
				[join(outdir, "index.mjs")],
				{
					encoding: "utf8",
				},
			);
			expect(stdout.trim()).toBe("hello-from-fakebin");
		},
	);

	it("recovers in watch mode after a transient failure (no poisoned memo)", async () => {
		const fetchImpl = stubFetch();
		fetchImpl.mockRejectedValueOnce(new Error("offline"));
		const cacheDir = await mkdtemp(join(tmpdir(), "neon-mise-cache-"));

		const { context } = await import("esbuild");
		const ctx = await context({
			stdin: { contents: "export {};", resolveDir: process.cwd() },
			bundle: true,
			write: false,
			outfile: "index.mjs",
			logLevel: "silent",
			plugins: [
				misePlugin({
					tools: { "ubi:acme/mytool": "1.0.0" },
					platforms: ["linux-arm64"],
					cacheDir,
				}),
			],
		});
		try {
			await expect(ctx.rebuild()).rejects.toThrow(/offline/);
			// Network is back (the stub's default impl): the rebuild must retry.
			const result = await ctx.rebuild();
			expect(
				result.outputFiles?.some((f) => f.path.includes("linux-arm64")),
			).toBe(true);
		} finally {
			await ctx.dispose();
		}
	});

	it("errors when there is no outdir/outfile to emit binaries into", async () => {
		stubFetch();
		// esbuild prints the bundle to stdout in this configuration; swallow it so
		// console-fail-test doesn't flag the build's own output.
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const cacheDir = await mkdtemp(join(tmpdir(), "neon-mise-cache-"));
		await expect(
			build({
				stdin: { contents: "export {};", resolveDir: process.cwd() },
				bundle: true,
				logLevel: "silent",
				plugins: [
					misePlugin({
						tools: { "ubi:acme/mytool": "1.0.0" },
						platforms: ["linux-arm64"],
						cacheDir,
					}),
				],
			}),
		).rejects.toThrow(/requires `outdir` or `outfile`/);
	});

	it("warns when nothing imports the runtime (manifest never baked)", async () => {
		stubFetch();
		const cacheDir = await mkdtemp(join(tmpdir(), "neon-mise-cache-"));
		const result = await build({
			stdin: { contents: "export {};", resolveDir: process.cwd() },
			bundle: true,
			write: false,
			outfile: "index.mjs",
			logLevel: "silent",
			plugins: [
				misePlugin({
					tools: { "ubi:acme/mytool": "1.0.0" },
					platforms: ["linux-arm64"],
					cacheDir,
				}),
			],
		});
		expect(result.warnings).toEqual([
			expect.objectContaining({
				text: expect.stringContaining("manifest was not baked"),
			}),
		]);
	});

	// The const-folding regression happened in THIS package's own tsdown build:
	// rolldown inlined the placeholder's `null` into dist/runtime.js, severing it
	// from dist/manifest.js and silently disabling the consumer-build
	// substitution. Pin that dist/runtime.js keeps a live default import.
	it.skipIf(!existsSync(DIST_RUNTIME))(
		"dist/runtime.js keeps a live import of the manifest placeholder",
		async () => {
			const dist = await readFile(DIST_RUNTIME, "utf8");
			expect(dist).toMatch(/import \w+ from ["']\.\/manifest\.js["']/);
			expect(
				fileURLToPath(new URL("../dist/manifest.js", import.meta.url)),
			).toMatch(MANIFEST_MODULE_PATTERN);
		},
	);

	it("fails the build with a clear error when a tool cannot be resolved", async () => {
		stubFetch();
		const cacheDir = await mkdtemp(join(tmpdir(), "neon-mise-cache-"));
		await expect(
			build({
				stdin: { contents: "export {};", resolveDir: process.cwd() },
				bundle: true,
				write: false,
				outfile: "index.mjs",
				plugins: [
					misePlugin({
						tools: { "ubi:acme/missing": "9.9.9" },
						platforms: ["linux-arm64"],
						cacheDir,
					}),
				],
				logLevel: "silent",
			}),
		).rejects.toThrow(
			/release "v9\.9\.9" \/ "9\.9\.9" not found for acme\/missing/,
		);
	});
});
