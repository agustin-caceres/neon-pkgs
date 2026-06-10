import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedFunctionConfig } from "@neondatabase/config";
import type { OutputFile, Plugin } from "esbuild";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildFunctionBundle } from "./function-bundle.js";

/**
 * Read an entry's unix mode out of the ZIP central directory (version-made-by
 * OS byte must be 3/Unix for the attrs to be interpreted as permissions).
 */
function zipEntryMode(zip: Uint8Array, name: string): number {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	for (let i = 0; i + 46 <= zip.length; i++) {
		if (view.getUint32(i, true) !== 0x02014b50) continue;
		const nameLen = view.getUint16(i + 28, true);
		const entryName = new TextDecoder().decode(
			zip.subarray(i + 46, i + 46 + nameLen),
		);
		if (entryName === name) {
			expect(view.getUint8(i + 5)).toBe(3); // version-made-by OS: Unix
			return (view.getUint32(i + 38, true) >>> 16) & 0o7777;
		}
		i +=
			46 +
			nameLen +
			view.getUint16(i + 30, true) +
			view.getUint16(i + 32, true) -
			1;
	}
	throw new Error(`zip entry ${name} not found`);
}

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "neon-bundle-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function fn(source: string): ResolvedFunctionConfig {
	return {
		slug: "fn1",
		name: "Hello World",
		source,
		env: {},
		runtime: "nodejs24",
	};
}

describe("buildFunctionBundle", () => {
	test("bundles a handler with esbuild and returns a ZIP containing index.mjs + sourcemap", async () => {
		const helper = join(dir, "shared.ts");
		writeFileSync(helper, "export const greeting = 'hello from neon';\n");
		const source = join(dir, "hello-world.ts");
		// Importing a sibling proves esbuild actually *bundles* (not just copies) the entry.
		writeFileSync(
			source,
			[
				"import { greeting } from './shared.js';",
				"export default { fetch(_req: Request): Response { return new Response(greeting); } };",
			].join("\n"),
		);

		const bundle = await buildFunctionBundle(fn(source));
		expect(bundle.byteLength).toBeGreaterThan(0);

		const files = unzipSync(bundle);
		const names = Object.keys(files).sort();
		expect(names).toContain("index.mjs");
		expect(names).toContain("index.mjs.map");

		// The bundled output should have inlined the imported constant.
		const js = new TextDecoder().decode(files["index.mjs"]);
		expect(js).toContain("hello from neon");
	});

	test("preserves nested paths and unix modes for plugin-emitted files", async () => {
		const source = join(dir, "with-tools.ts");
		writeFileSync(
			source,
			"export default { fetch: () => new Response() };",
		);

		// Mirrors the contract @neondatabase/esbuild-plugin-mise uses: extra
		// OutputFiles appended in onEnd, executables carrying a `mode` property.
		const fakeToolPlugin: Plugin = {
			name: "fake-tool",
			setup(build) {
				build.onEnd((result) => {
					result.outputFiles?.push({
						path: join(process.cwd(), "tools/linux-arm64/mytool"),
						contents: new TextEncoder().encode("ELF"),
						hash: "",
						get text() {
							return "ELF";
						},
						mode: 0o755,
					} as OutputFile & { mode: number });
				});
			},
		};

		const bundle = await buildFunctionBundle(fn(source), {
			plugins: [fakeToolPlugin],
		});
		const files = unzipSync(bundle);

		// Nested layout survives (no basename flattening)…
		expect(Object.keys(files)).toContain("tools/linux-arm64/mytool");
		// …and so do the unix permissions, for executables and regular files alike.
		expect(zipEntryMode(bundle, "tools/linux-arm64/mytool")).toBe(0o755);
		expect(zipEntryMode(bundle, "index.mjs")).toBe(0o644);
	});

	test("throws a PlatformError when the source cannot be resolved", async () => {
		await expect(
			buildFunctionBundle(fn(join(dir, "does-not-exist.ts"))),
		).rejects.toThrow(/Failed to bundle function "fn1"/);
	});
});
