import { defineConfig } from "tsdown";

export default defineConfig({
	name: "neonctl",
	bundle: false,
	clean: true,
	dts: true,
	entry: ["src/cli.ts"],
	format: "esm",
	outDir: "dist",
	treeshake: true,
});
