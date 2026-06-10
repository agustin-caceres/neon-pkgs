import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BakedManifest, Platform } from "./lib/types.js";
import { installTools } from "./runtime.js";

const platform = `${process.platform}-${process.arch}` as Platform;

async function makeBundleDir(bins: Record<string, string>): Promise<string> {
	const bundleDir = await mkdtemp(join(tmpdir(), "neon-mise-bundle-"));
	const toolsDir = join(bundleDir, "tools", platform);
	await mkdir(toolsDir, { recursive: true });
	for (const [bin, content] of Object.entries(bins)) {
		// No executable bit on purpose: the bundle pipeline may strip modes, and
		// the runtime must restore them when staging.
		await writeFile(join(toolsDir, bin), content, { mode: 0o644 });
	}
	return bundleDir;
}

function makeManifest(bins: string[]): BakedManifest {
	return {
		version: 1,
		toolsDir: "tools",
		platforms: [platform],
		tools: bins.map((bin) => ({ name: bin, version: "1.0.0", bin })),
	};
}

describe("installTools", () => {
	it("no-ops (with a warning) when no manifest is baked in", async () => {
		const warn = vi
			.spyOn(process, "emitWarning")
			.mockImplementation(() => undefined);
		expect(await installTools(null)).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("stages binaries into a writable dir, chmods them, and prepends PATH", async () => {
		const bundleDir = await makeBundleDir({
			fakebin: "#!/bin/sh\necho hi",
		});
		const destDir = join(
			await mkdtemp(join(tmpdir(), "neon-mise-dest-")),
			"tools",
		);
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

		const result = await installTools(makeManifest(["fakebin"]), {
			bundleDir,
			destDir,
			env,
		});

		expect(result).toEqual({
			binDir: destDir,
			tools: [{ name: "fakebin", version: "1.0.0", bin: "fakebin" }],
		});
		expect(env.PATH).toBe(`${destDir}${delimiter}/usr/bin`);
		const staged = join(destDir, "fakebin");
		expect(await readFile(staged, "utf8")).toBe("#!/bin/sh\necho hi");
		if (process.platform !== "win32") {
			expect((await stat(staged)).mode & 0o111).not.toBe(0);
		}
	});

	it("is idempotent: reuses an existing dest and never duplicates PATH entries", async () => {
		const bundleDir = await makeBundleDir({ fakebin: "v1" });
		const destDir = join(
			await mkdtemp(join(tmpdir(), "neon-mise-dest-")),
			"tools",
		);
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
		const manifest = makeManifest(["fakebin"]);

		await installTools(manifest, { bundleDir, destDir, env });
		await installTools(manifest, { bundleDir, destDir, env });

		expect(env.PATH).toBe(`${destDir}${delimiter}/usr/bin`);
	});

	it("rejects manifests with an unknown version (globalThis injection path)", async () => {
		const manifest = {
			...makeManifest(["fakebin"]),
			version: 2,
		} as unknown as BakedManifest;
		await expect(installTools(manifest, { env: {} })).rejects.toThrow(
			/unsupported manifest version 2/,
		);
	});

	it("throws when the current platform was not bundled", async () => {
		const manifest: BakedManifest = {
			...makeManifest(["fakebin"]),
			platforms: [],
		};
		await expect(installTools(manifest, { env: {} })).rejects.toThrow(
			new RegExp(`no tools were bundled for ${platform}`),
		);
	});

	it("explains when the tools folder is missing from the deployed bundle", async () => {
		const bundleDir = await mkdtemp(join(tmpdir(), "neon-mise-empty-"));
		const destDir = join(bundleDir, "dest");
		await expect(
			installTools(makeManifest(["fakebin"]), {
				bundleDir,
				destDir,
				env: {},
			}),
		).rejects.toThrow(/tool binary not found at/);
	});
});
