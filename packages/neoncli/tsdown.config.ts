import { defineConfig } from "tsdown";

export default defineConfig({
	name: "neoncli",
	bundle: false,
	clean: true,
	dts: true,
	entry: ["src/cli.ts"],
	format: "esm",
	outDir: "dist",
	treeshake: true,
});
