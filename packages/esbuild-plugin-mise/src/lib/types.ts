/**
 * Platforms the plugin can download tool binaries for. The runtime helper maps
 * `process.platform`-`process.arch` onto this set to pick the right folder.
 */
export type Platform =
	| "linux-x64"
	| "linux-arm64"
	| "darwin-x64"
	| "darwin-arm64";

/** Long-form tool spec. The string shorthand is just a version (`"14.1.1"` or `"latest"`). */
export interface ToolSpecObject {
	/** Version to install. Defaults to `"latest"` (resolved and pinned at build time). */
	version?: string;
	/**
	 * GitHub `owner/repo` to download release assets from (mise's `ubi` backend
	 * syntax). Mutually exclusive with `url`.
	 */
	ubi?: string;
	/**
	 * Direct download URL template. Supports `{version}`, `{os}` (`linux`/`darwin`),
	 * `{arch}` (`x64`/`arm64`) and `{target}` (looked up in `targets`). Requires an
	 * explicit `version` (there is no release feed to resolve `latest` against).
	 * Mutually exclusive with `ubi`.
	 */
	url?: string;
	/** Per-platform value substituted for `{target}` in `url`. */
	targets?: Partial<Record<Platform, string>>;
	/** Name of the executable. Defaults to the catalog entry, else the tool key / repo name. */
	bin?: string;
	/**
	 * Substring that must appear in the GitHub release asset name. Use to
	 * disambiguate when the heuristics pick the wrong asset.
	 */
	asset?: string;
	/**
	 * GitHub tag prefix for pinned versions, e.g. `"jq-"` when tags look like
	 * `jq-1.7.1`. By default `v{version}` and `{version}` are tried.
	 */
	tagPrefix?: string;
}

export type ToolSpec = string | ToolSpecObject;

export interface MisePluginOptions {
	/**
	 * Tools to ship. Keys are catalog short names (`ripgrep`, `jq`, `gh`, …),
	 * mise-style `ubi:owner/repo` specs, or arbitrary names when the value
	 * provides `ubi`/`url`. When omitted, the project's `mise.toml` is used.
	 */
	tools?: Record<string, ToolSpec>;
	/** Path to a mise config file. Defaults to `mise.toml` / `.mise.toml` in the working directory. */
	configFile?: string;
	/** Platforms to download binaries for. Defaults to `["linux-x64", "linux-arm64"]`. */
	platforms?: Platform[];
	/** Name of the folder (inside the build output) holding the binaries. Defaults to `"tools"`. */
	toolsDir?: string;
	/**
	 * Download cache directory. Defaults to
	 * `<cwd>/node_modules/.cache/@neondatabase/esbuild-plugin-mise`. The plugin
	 * never writes outside this directory and the build output.
	 */
	cacheDir?: string;
}

/** A tool spec normalized against the catalog, before versions are resolved. */
export interface ResolvedToolSpec {
	name: string;
	bin: string;
	version: string;
	asset?: string;
	source:
		| { type: "github"; repo: string; tagPrefix?: string }
		| {
				type: "url";
				template: string;
				targets?: Partial<Record<Platform, string>>;
		  };
}

export interface BakedTool {
	name: string;
	version: string;
	bin: string;
	/** Per-platform sha256 of the shipped binary — keys the runtime's staging dir to the actual content. */
	hashes?: Partial<Record<Platform, string>>;
}

/**
 * What the plugin bakes into the runtime module: enough for `ensureTools()` to
 * locate, stage, and PATH the shipped binaries — no network, no resolution.
 */
export interface BakedManifest {
	version: 1;
	toolsDir: string;
	platforms: Platform[];
	tools: BakedTool[];
}
