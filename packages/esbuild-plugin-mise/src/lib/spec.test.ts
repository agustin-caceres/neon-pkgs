import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeToolSpec, resolveToolSpecs } from "./spec.js";

describe("normalizeToolSpec", () => {
	it("resolves catalog short names with their bin and repo", () => {
		expect(normalizeToolSpec("ripgrep", "14.1.1")).toEqual({
			name: "ripgrep",
			bin: "rg",
			version: "14.1.1",
			asset: undefined,
			source: {
				type: "github",
				repo: "BurntSushi/ripgrep",
				tagPrefix: undefined,
			},
		});
	});

	it("carries the catalog tagPrefix (jq tags look like jq-1.7.1)", () => {
		const spec = normalizeToolSpec("jq", "1.7.1");
		expect(spec.source).toEqual({
			type: "github",
			repo: "jqlang/jq",
			tagPrefix: "jq-",
		});
	});

	it("strips a leading v from versions", () => {
		expect(normalizeToolSpec("jq", "v1.7.1").version).toBe("1.7.1");
	});

	it("defaults the version to latest", () => {
		expect(normalizeToolSpec("jq", {}).version).toBe("latest");
	});

	it("parses ubi:owner/repo keys, defaulting bin to the repo name", () => {
		expect(normalizeToolSpec("ubi:sharkdp/hyperfine", "latest")).toEqual({
			name: "ubi:sharkdp/hyperfine",
			bin: "hyperfine",
			version: "latest",
			asset: undefined,
			source: {
				type: "github",
				repo: "sharkdp/hyperfine",
				tagPrefix: undefined,
			},
		});
	});

	it("lets the object form override bin and asset", () => {
		const spec = normalizeToolSpec("ubi:cli/cli", {
			version: "2.62.0",
			bin: "gh",
			asset: "linux",
		});
		expect(spec.bin).toBe("gh");
		expect(spec.asset).toBe("linux");
	});

	it("accepts url templates with targets", () => {
		const spec = normalizeToolSpec("mytool", {
			version: "2.0.0",
			url: "https://example.com/{version}/mytool-{target}.tar.gz",
			targets: { "linux-arm64": "aarch64-linux" },
		});
		expect(spec.source).toEqual({
			type: "url",
			template: "https://example.com/{version}/mytool-{target}.tar.gz",
			targets: { "linux-arm64": "aarch64-linux" },
		});
	});

	it("rejects url specs without a pinned version", () => {
		expect(() =>
			normalizeToolSpec("mytool", { url: "https://example.com/x" }),
		).toThrow(/requires an explicit `version`/);
	});

	it("rejects specs with both ubi and url", () => {
		expect(() =>
			normalizeToolSpec("mytool", {
				version: "1",
				ubi: "a/b",
				url: "https://x",
			}),
		).toThrow(/both `ubi` and `url`/);
	});

	it("rejects unknown short names with a helpful message", () => {
		expect(() => normalizeToolSpec("node", "22")).toThrow(
			/unknown tool "node"/,
		);
	});

	it("rejects malformed ubi specs", () => {
		expect(() => normalizeToolSpec("ubi:not-a-repo", "1")).toThrow(
			/invalid ubi spec/,
		);
	});
});

describe("resolveToolSpecs", () => {
	it("rejects two tools installing the same bin name", async () => {
		await expect(
			resolveToolSpecs(
				{ tools: { ripgrep: "14.1.1", rg: "14.1.0" } },
				process.cwd(),
			),
		).rejects.toThrow(/both install a binary named "rg"/);
	});

	it("rejects an empty tool set", async () => {
		await expect(
			resolveToolSpecs({ tools: {} }, process.cwd()),
		).rejects.toThrow(/no tools declared/);
	});

	it("falls back to mise.toml, accepting string and table versions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "neon-mise-spec-"));
		await writeFile(
			join(dir, "mise.toml"),
			[
				"[tools]",
				'jq = "1.7.1"',
				'"ubi:sharkdp/hyperfine" = { version = "1.18.0" }',
			].join("\n"),
		);
		const specs = await resolveToolSpecs({}, dir);
		expect(specs.map((s) => [s.name, s.version])).toEqual([
			["jq", "1.7.1"],
			["ubi:sharkdp/hyperfine", "1.18.0"],
		]);
	});

	it("resolves a relative configFile against the build cwd", async () => {
		const dir = await mkdtemp(join(tmpdir(), "neon-mise-spec-"));
		await writeFile(join(dir, "tools.toml"), '[tools]\njq = "1.7.1"');
		const specs = await resolveToolSpecs({ configFile: "tools.toml" }, dir);
		expect(specs.map((s) => s.name)).toEqual(["jq"]);
	});

	it("errors on mise table options it does not implement instead of silently dropping them", async () => {
		const dir = await mkdtemp(join(tmpdir(), "neon-mise-spec-"));
		await writeFile(
			join(dir, "mise.toml"),
			["[tools]", 'gh = { version = "2.62.0", os = ["macos"] }'].join(
				"\n",
			),
		);
		await expect(resolveToolSpecs({}, dir)).rejects.toThrow(
			/uses option `os` that this plugin does not implement/,
		);
	});

	it("errors on mise.toml tools it cannot represent (arrays, exotic backends)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "neon-mise-spec-"));
		await writeFile(
			join(dir, "mise.toml"),
			["[tools]", 'jq = ["1.7.1", "1.7.0"]'].join("\n"),
		);
		await expect(resolveToolSpecs({}, dir)).rejects.toThrow(
			/unsupported value for tool "jq"/,
		);
	});

	it("errors when no mise config exists", async () => {
		const dir = await mkdtemp(join(tmpdir(), "neon-mise-spec-"));
		await expect(resolveToolSpecs({}, dir)).rejects.toThrow(
			/no mise config found/,
		);
	});
});
