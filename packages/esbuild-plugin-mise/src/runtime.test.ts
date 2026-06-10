import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BakedManifest, Platform } from "./lib/types.js";
import { installTools } from "./runtime.js";

const platform = `${process.platform}-${process.arch}` as Platform;

async function makeBundleDir(
	bins: Record<string, string>,
	mode: number,
): Promise<string> {
	const bundleDir = await mkdtemp(join(tmpdir(), "neon-mise-bundle-"));
	const toolsDir = join(bundleDir, "tools", platform);
	await mkdir(toolsDir, { recursive: true });
	for (const [bin, content] of Object.entries(bins)) {
		await writeFile(join(toolsDir, bin), content, { mode });
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

	it("prepends the bundled tools folder to PATH", async () => {
		const bundleDir = await makeBundleDir({ fakebin: "#!/bin/sh" }, 0o755);
		const toolsDir = join(bundleDir, "tools", platform);
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

		const result = await installTools(makeManifest(["fakebin"]), {
			bundleDir,
			env,
		});

		expect(result).toEqual({
			binDir: toolsDir,
			tools: [{ name: "fakebin", version: "1.0.0", bin: "fakebin" }],
		});
		expect(env.PATH).toBe(`${toolsDir}${delimiter}/usr/bin`);
	});

	it("never duplicates the PATH entry on repeat calls", async () => {
		const bundleDir = await makeBundleDir({ fakebin: "v1" }, 0o755);
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
		const manifest = makeManifest(["fakebin"]);

		await installTools(manifest, { bundleDir, env });
		await installTools(manifest, { bundleDir, env });

		expect(env.PATH).toBe(
			`${join(bundleDir, "tools", platform)}${delimiter}/usr/bin`,
		);
	});

	it.skipIf(process.platform === "win32")(
		"fails with a deploy-pipeline hint when a binary lost its executable bit",
		async () => {
			const bundleDir = await makeBundleDir(
				{ fakebin: "stripped" },
				0o644,
			);
			await expect(
				installTools(makeManifest(["fakebin"]), { bundleDir, env: {} }),
			).rejects.toThrow(/exists but is not executable.*deploy pipeline/);
		},
	);

	it("no-ops on an empty manifest (build ran without a mise config)", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
		const result = await installTools(
			{ version: 1, toolsDir: "tools", platforms: [], tools: [] },
			{ env },
		);
		expect(result).toEqual({ binDir: null, tools: [] });
		expect(env.PATH).toBe("/usr/bin");
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
		await expect(
			installTools(makeManifest(["fakebin"]), { bundleDir, env: {} }),
		).rejects.toThrow(/tool binary not found at/);
	});
});
