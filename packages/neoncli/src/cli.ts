#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;

// Soft, every-run nudge (stderr so it never pollutes piped stdout).
process.stderr.write(
	`${dim("`neoncli` is not the Neon CLI. The CLI is")} ${bold("neon")}${dim(
		" — forwarding to `neon`. Install `neon` and use it directly.",
	)}\n`,
);

const require = createRequire(import.meta.url);
const neonPkgJsonPath = require.resolve("neon/package.json");
const neonDir = dirname(neonPkgJsonPath);

const neonPkg: { bin: string | Record<string, string> } = require(
	neonPkgJsonPath,
);
const binEntry =
	typeof neonPkg.bin === "string" ? neonPkg.bin : neonPkg.bin.neon;
const neonCli = join(neonDir, binEntry);

// The Neon CLI derives its program name from `basename(argv[1])`; point it at a
// path named `neon` so help/usage render as `neon`, then run it in-process.
process.argv[1] = join(neonDir, "neon");

await import(pathToFileURL(neonCli).href);
