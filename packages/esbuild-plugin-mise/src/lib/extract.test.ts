import { gzipSync } from "node:zlib";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makeTar, paxRecords } from "../../test-helpers/tar.js";
import { extractBinary, untar } from "./extract.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("untar", () => {
	it("reads regular files with their mode", () => {
		const tar = makeTar([
			{ name: "dir/rg", data: bytes("binary!"), mode: 0o755 },
			{ name: "dir/README.md", data: bytes("docs") },
		]);
		const files = untar(tar);
		expect(files.map((f) => f.name)).toEqual(["dir/rg", "dir/README.md"]);
		expect(files[0].mode & 0o111).not.toBe(0);
		expect(new TextDecoder().decode(files[0].data)).toBe("binary!");
	});
});

describe("untar (pax)", () => {
	it("applies pax path overrides (bsdtar-style archives with >100-char paths)", () => {
		const longPath = `${"deeply/".repeat(16)}bin/mytool`; // 122 chars — overflows the ustar name field
		const tar = makeTar([
			{
				name: "PaxHeader/mytool",
				typeflag: "x",
				data: paxRecords({ path: longPath }),
			},
			{
				name: longPath.slice(0, 100),
				data: bytes("pax-bin"),
				mode: 0o755,
			},
		]);
		const files = untar(tar);
		expect(files).toHaveLength(1);
		expect(files[0].name).toBe(longPath);
		expect(new TextDecoder().decode(files[0].data)).toBe("pax-bin");
	});
});

describe("extractBinary", () => {
	it("finds the binary by basename in a nested .tar.gz (gh-style layout)", async () => {
		const tar = makeTar([
			{ name: "gh_2.62.0_linux_arm64/LICENSE", data: bytes("license") },
			{
				name: "gh_2.62.0_linux_arm64/bin/gh",
				data: bytes("gh-bin"),
				mode: 0o755,
			},
		]);
		const result = await extractBinary(
			gzipSync(tar),
			"gh_2.62.0_linux_arm64.tar.gz",
			"gh",
		);
		expect(new TextDecoder().decode(result)).toBe("gh-bin");
	});

	it("prefers the executable entry when names collide", async () => {
		const tar = makeTar([
			{ name: "docs/tool", data: bytes("not me"), mode: 0o644 },
			{ name: "bin/tool", data: bytes("me"), mode: 0o755 },
		]);
		const result = await extractBinary(gzipSync(tar), "tool.tgz", "tool");
		expect(new TextDecoder().decode(result)).toBe("me");
	});

	it("extracts from zip archives", async () => {
		const zip = zipSync({ "bin/gh": bytes("gh-zip") });
		const result = await extractBinary(zip, "gh_macOS.zip", "gh");
		expect(new TextDecoder().decode(result)).toBe("gh-zip");
	});

	it("falls back to a single-file archive regardless of name", async () => {
		const tar = makeTar([
			{ name: "tool-v1-linux", data: bytes("only-file") },
		]);
		const result = await extractBinary(
			gzipSync(tar),
			"tool.tar.gz",
			"tool",
		);
		expect(new TextDecoder().decode(result)).toBe("only-file");
	});

	it("treats extension-less assets as the raw binary (jq-style)", async () => {
		const result = await extractBinary(
			bytes("raw-binary"),
			"jq-linux-arm64",
			"jq",
		);
		expect(new TextDecoder().decode(result)).toBe("raw-binary");
	});

	it("gunzips bare .gz assets", async () => {
		const result = await extractBinary(
			gzipSync(bytes("unzipped")),
			"tool-linux-arm64.gz",
			"tool",
		);
		expect(new TextDecoder().decode(result)).toBe("unzipped");
	});

	it("falls back to a unique executable prefix match (yq-style per-platform names)", async () => {
		// Real layout of yq_linux_amd64.tar.gz: the binary keeps its per-platform
		// name inside the archive, next to a man page and an install script.
		const tar = makeTar([
			{ name: "./yq_linux_amd64", data: bytes("yq-bin"), mode: 0o755 },
			{ name: "./yq.1", data: bytes("man page"), mode: 0o644 },
			{
				name: "./install-man-page.sh",
				data: bytes("#!/bin/sh"),
				mode: 0o755,
			},
		]);
		const result = await extractBinary(gzipSync(tar), "yq.tar.gz", "yq");
		expect(new TextDecoder().decode(result)).toBe("yq-bin");
	});

	it("falls back to the single executable when names don't match at all", async () => {
		const tar = makeTar([
			{ name: "pkg/the-actual-binary", data: bytes("bin"), mode: 0o755 },
			{ name: "pkg/README.md", data: bytes("docs"), mode: 0o644 },
		]);
		const result = await extractBinary(gzipSync(tar), "pkg.tar.gz", "tool");
		expect(new TextDecoder().decode(result)).toBe("bin");
	});

	it("refuses compression formats it cannot decode instead of shipping the bytes raw", async () => {
		await expect(
			extractBinary(
				bytes("zstd bytes"),
				"tool-linux-arm64.tar.zst",
				"tool",
			),
		).rejects.toThrow(/cannot extract tool-linux-arm64\.tar\.zst/);
	});

	it("errors with the archive listing when the binary is missing", async () => {
		const tar = makeTar([
			{ name: "a", data: bytes("a") },
			{ name: "b", data: bytes("b") },
		]);
		await expect(
			extractBinary(gzipSync(tar), "tool.tar.gz", "tool"),
		).rejects.toThrow(/no file named "tool" in tool\.tar\.gz.*a, b/);
	});
});
