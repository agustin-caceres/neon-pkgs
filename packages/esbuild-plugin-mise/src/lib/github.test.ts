import { describe, expect, it } from "vitest";
import { selectAsset } from "./github.js";

const asset = (name: string) => ({ name, url: `https://dl.example/${name}` });

describe("selectAsset", () => {
	const ripgrep = [
		asset("ripgrep-14.1.1-aarch64-apple-darwin.tar.gz"),
		asset("ripgrep-14.1.1-aarch64-unknown-linux-gnu.tar.gz"),
		asset("ripgrep-14.1.1-x86_64-unknown-linux-gnu.tar.gz"),
		asset("ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz"),
		asset("ripgrep-14.1.1-x86_64-apple-darwin.tar.gz"),
		asset("ripgrep-14.1.1.sha256"),
	];

	it("matches os + arch markers (cargo-style triples)", () => {
		expect(selectAsset(ripgrep, "linux-arm64").name).toBe(
			"ripgrep-14.1.1-aarch64-unknown-linux-gnu.tar.gz",
		);
		expect(selectAsset(ripgrep, "darwin-arm64").name).toBe(
			"ripgrep-14.1.1-aarch64-apple-darwin.tar.gz",
		);
	});

	it("prefers musl (static) builds on linux", () => {
		expect(selectAsset(ripgrep, "linux-x64").name).toBe(
			"ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz",
		);
	});

	it("never picks checksum files", () => {
		expect(
			selectAsset(
				[
					asset("tool-linux-arm64.tar.gz"),
					asset("tool-linux-arm64.tar.gz.sha256"),
				],
				"linux-arm64",
			).name,
		).toBe("tool-linux-arm64.tar.gz");
	});

	it("matches raw binaries with go-style names (jq)", () => {
		const jq = [
			asset("jq-linux-amd64"),
			asset("jq-linux-arm64"),
			asset("jq-macos-arm64"),
			asset("jq-windows-amd64.exe"),
		];
		expect(selectAsset(jq, "linux-arm64").name).toBe("jq-linux-arm64");
		expect(selectAsset(jq, "darwin-arm64").name).toBe("jq-macos-arm64");
	});

	it("falls back to arch-less assets when no asset carries an arch marker", () => {
		const archless = [
			asset("tool-linux.tar.gz"),
			asset("tool-macos.tar.gz"),
		];
		expect(selectAsset(archless, "linux-x64").name).toBe(
			"tool-linux.tar.gz",
		);
	});

	it("honors the asset hint as a hard filter", () => {
		expect(
			selectAsset(ripgrep, "linux-x64", "unknown-linux-gnu").name,
		).toBe("ripgrep-14.1.1-x86_64-unknown-linux-gnu.tar.gz");
	});

	it("trusts a hint that pins a single asset, even past the reject heuristics", () => {
		const assets = [
			asset("tool-linux-arm64.tar.gz"),
			asset("tool-special.bin.txt"),
		];
		expect(selectAsset(assets, "linux-arm64", "special").name).toBe(
			"tool-special.bin.txt",
		);
	});

	it("rejects formats we cannot extract (.tar.xz, .tar.zst)", () => {
		const undecodable = [
			asset("tool-linux-arm64.tar.xz"),
			asset("tool-linux-arm64.tar.zst"),
		];
		expect(() => selectAsset(undecodable, "linux-arm64")).toThrow(
			/no release asset matches linux-arm64/,
		);
	});

	it("prefers a decodable archive over a zst-compressed one (mise-style releases)", () => {
		const assets = [
			asset("tool-x86_64-unknown-linux-musl.tar.zst"),
			asset("tool-x86_64-unknown-linux-gnu.tar.gz"),
		];
		expect(selectAsset(assets, "linux-x64").name).toBe(
			"tool-x86_64-unknown-linux-gnu.tar.gz",
		);
	});

	it("lists the available assets in the error", () => {
		expect(() =>
			selectAsset(ripgrep, "linux-arm64", "nonexistent"),
		).toThrow(/aarch64-unknown-linux-gnu/);
	});
});
