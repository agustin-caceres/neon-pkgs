# @neondatabase/esbuild-plugin-mise

Ship CLI tools (ripgrep, jq, gh, …) **inside your esbuild bundle**, and put them on `PATH` at runtime with one call. Designed for code that runs in sandboxes you don't control — serverless functions, agent runtimes — where the deployed filesystem is read-only and `apt-get` doesn't exist.

- **Build time**: the plugin resolves your tool list (from plugin options or your project's [`mise.toml`](https://mise.jdx.dev/)), downloads the matching release binaries for each target platform, and emits them next to your bundle under `tools/<platform>/`.
- **Runtime**: a tree-shakeable helper (`@neondatabase/esbuild-plugin-mise/runtime`) prepends the bundled `tools/<platform>/` folder to `process.env.PATH`. Your code — or your agent's `bash` tool — can then just run `rg`, `jq`, `gh`.
- **Never pollutes the user's system**: nothing is installed globally, nothing is written at runtime. Build-time downloads are cached under `node_modules/.cache/`. No `$HOME`, no shell profile.

> **Note:** this plugin does not run mise. It parses your `mise.toml` and reimplements a subset of mise's `ubi` (GitHub releases) backend in TypeScript, because mise can only install tools for the platform it runs on — and here the build machine and the deploy target usually differ. A mise installation is neither required nor touched.

## Usage

### 1. Build with the plugin

```ts
import { build } from "esbuild";
import { misePlugin } from "@neondatabase/esbuild-plugin-mise";

await build({
	entryPoints: ["src/agent.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	outdir: "dist",
	plugins: [
		misePlugin({
			tools: {
				ripgrep: "14.1.1",
				jq: "latest", // resolved and pinned at build time
				"ubi:sharkdp/hyperfine": "1.18.0", // any GitHub repo, mise ubi syntax
			},
		}),
	],
});
```

This produces:

```
dist/
  agent.js
  tools/
    linux-x64/   rg  jq  hyperfine
    linux-arm64/ rg  jq  hyperfine
```

Deploy `dist/` as a whole — the `tools/` folder must travel with the bundle.

If you omit `tools`, the plugin reads the `[tools]` section of your project's `mise.toml` / `.mise.toml` (`name = "version"` and `name = { version = "..." }` entries) — or of the file you point it at with `configFile`. Anything it can't faithfully reproduce — language runtimes like `node`/`python`, version arrays, mise table options like `os` — is rejected with an explanation rather than silently behaving differently from mise: this plugin covers single-binary CLIs, not the full mise registry.

If the config file doesn't exist (or has no `[tools]` section), the plugin logs an info message and bundles no tools: the build succeeds, and `ensureTools()` resolves to `{ binDir: null, tools: [] }` at runtime. Adding a `mise.toml` later just works — no build-config change needed.

### 2. Put the tools on PATH at runtime

```ts
import { ensureTools } from "@neondatabase/esbuild-plugin-mise/runtime";

// Top level: runs once per instance, off the request path.
await ensureTools();

// From here on, the tools are plain PATH commands:
import { execFile } from "node:child_process";
execFile("rg", ["--json", "TODO", "."], (err, stdout) => console.log(stdout));
```

`ensureTools()`:

- verifies the bundled binaries are present and executable (failing with an actionable error if the deploy pipeline stripped file modes — see Limitations), then prepends the bundle's own `tools/<platform>/` folder to `process.env.PATH` (inherited by every child process);
- writes nothing: the binaries run in place, straight from the deployed bundle;
- is memoized and safe to call concurrently;
- is a **no-op returning `null`** when the bundle wasn't built with the plugin — in local dev, where you presumably have mise and the tools on `PATH` already, the same code just runs.

The `/runtime` subpath contains no plugin code: importing it does not pull esbuild, the resolver, or anything network-related into your bundle.

## How tools are resolved

| Spec | Example | Behavior |
| --- | --- | --- |
| Catalog short name | `ripgrep: "14.1.1"` | Built-in mapping to the project's GitHub releases (`ripgrep`/`rg`, `jq`, `fd`, `bat`, `gh`, `yq`). |
| `ubi:owner/repo` | `"ubi:sharkdp/hyperfine": "latest"` | Downloads from that repo's GitHub releases, picking the asset that matches each target platform (same idea as mise's `ubi` backend). |
| URL template | `{ url: "https://…/{version}/tool-{target}.tar.gz", targets: {...}, version: "2.0.0" }` | Fully explicit; for tools not on GitHub releases. |

`latest` is resolved against GitHub **at build time** and the concrete version is baked into the bundle — deploys are reproducible, and the runtime never hits the network. Release metadata for pinned versions and extracted binaries are cached on disk, so repeat builds work offline. Set `GITHUB_TOKEN` in CI to lift the anonymous GitHub API rate limit.

Supported asset formats: `.tar.gz` / `.tgz`, `.zip`, bare `.gz`, and raw binaries. When the heuristics pick the wrong release asset, pin it with `asset: "substring"`; when the binary has a different name inside the archive, set `bin`.

## Options

```ts
misePlugin({
	tools: { /* see above; default: read mise.toml */ },
	configFile: "path/to/mise.toml", // explicit mise config location
	platforms: ["linux-x64", "linux-arm64"], // default; add darwin-* for local-run targets
	toolsDir: "tools", // folder name inside the build output
	cacheDir: "node_modules/.cache/@neondatabase/esbuild-plugin-mise", // default
});
```

`ensureTools(options?)` accepts `bundleDir` (where `tools/` lives, default: the bundle's own directory) and `env` (defaults to `process.env`).

## Limitations

- Single-binary CLI tools only — no language runtimes, no tools that need an installer.
- **The deploy pipeline must preserve unix file modes** end-to-end: the binaries run in place, so they must arrive executable. `@neondatabase/config-runtime`'s function bundler records modes in its archives (and accepts this plugin via `buildFunctionBundle(fn, { plugins: [...] })`); if your pipeline strips them, `ensureTools()` fails with an explicit error rather than letting `spawn` hit a cryptic `EACCES`.
- `.tar.xz` / `.tar.bz2` / `.tar.zst` / `.7z` release assets cannot be extracted (the asset picker skips them); most projects also publish `.tar.gz` or `.zip`.
- Public GitHub repositories only — `GITHUB_TOKEN` lifts the API rate limit but private release assets are not supported.
- Linux and macOS targets only (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`).
- The bundle grows by the size of each tool × each target platform. Keep the tool set lean and the platform list tight.
