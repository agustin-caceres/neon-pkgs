import { defineConfig } from "tsdown";

export default defineConfig({
	name: "@neondatabase/esbuild-plugin-mise",
	bundle: false,
	clean: true,
	dts: true,
	entry: ["src/**/*.ts", "!src/**/*.test.*"],
	format: "esm",
	outDir: "dist",
	treeshake: true,
	// esbuild is a peer dependency (the consumer's own esbuild runs this plugin);
	// fflate and smol-toml are regular dependencies. All must resolve from
	// node_modules at runtime rather than being inlined.
	external: ["esbuild", "fflate", "smol-toml"],
});
