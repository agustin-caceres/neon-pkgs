import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CATALOG } from "./catalog.js";
import type {
	MisePluginOptions,
	ResolvedToolSpec,
	ToolSpec,
	ToolSpecObject,
} from "./types.js";

export interface ResolvedSpecs {
	specs: ResolvedToolSpec[];
	/**
	 * Set (with `specs: []`) when no explicit `tools` were given and the mise
	 * config is absent or has no `[tools]` section — the plugin logs this and
	 * bundles nothing rather than failing the build.
	 */
	skippedReason?: string;
}

/**
 * Turn the user's tool declarations (plugin options, falling back to the
 * project's mise.toml) into normalized specs. Pure name/catalog resolution —
 * no network; `"latest"` versions are resolved later against GitHub.
 */
export async function resolveToolSpecs(
	options: MisePluginOptions,
	cwd: string,
): Promise<ResolvedSpecs> {
	let tools = options.tools;
	if (tools === undefined) {
		const fromConfig = await readMiseToml(options.configFile, cwd);
		if (typeof fromConfig === "string") {
			return { specs: [], skippedReason: fromConfig };
		}
		tools = fromConfig;
	}
	const specs = Object.entries(tools).map(([name, spec]) =>
		normalizeToolSpec(name, spec),
	);
	if (specs.length === 0) {
		throw new Error(
			"@neondatabase/esbuild-plugin-mise: the `tools` option is empty. Declare at least one tool, or omit the option to read mise.toml.",
		);
	}
	const seen = new Map<string, string>();
	for (const spec of specs) {
		const other = seen.get(spec.bin);
		if (other !== undefined) {
			throw new Error(
				`@neondatabase/esbuild-plugin-mise: tools "${other}" and "${spec.name}" both install a binary named "${spec.bin}".`,
			);
		}
		seen.set(spec.bin, spec.name);
	}
	return { specs };
}

export function normalizeToolSpec(
	name: string,
	spec: ToolSpec,
): ResolvedToolSpec {
	const obj: ToolSpecObject =
		typeof spec === "string" ? { version: spec } : spec;
	if (obj.ubi !== undefined && obj.url !== undefined) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: tool "${name}" sets both \`ubi\` and \`url\` — pick one.`,
		);
	}

	const version = normalizeVersion(obj.version);

	if (obj.url !== undefined) {
		if (version === "latest") {
			throw new Error(
				`@neondatabase/esbuild-plugin-mise: tool "${name}" uses a \`url\` template, which requires an explicit \`version\` ("latest" can only be resolved for GitHub-backed tools).`,
			);
		}
		return {
			name,
			bin: obj.bin ?? name,
			version,
			source: { type: "url", template: obj.url, targets: obj.targets },
		};
	}

	const ubi = obj.ubi ?? parseUbiName(name);
	if (ubi !== undefined) {
		return {
			name,
			bin: obj.bin ?? ubi.split("/")[1],
			version,
			asset: obj.asset,
			source: { type: "github", repo: ubi, tagPrefix: obj.tagPrefix },
		};
	}

	const entry = CATALOG[name];
	if (entry === undefined) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: unknown tool "${name}". This plugin ships single-binary CLI tools — language runtimes and other mise backends (node, python, …) are out of scope. For a CLI, use a built-in short name (${Object.keys(CATALOG).join(", ")}), a "ubi:owner/repo" spec, or provide an explicit \`url\`.`,
		);
	}
	return {
		name,
		bin: obj.bin ?? entry.bin ?? name,
		version,
		asset: obj.asset ?? entry.asset,
		source: {
			type: "github",
			repo: entry.repo,
			tagPrefix: obj.tagPrefix ?? entry.tagPrefix,
		},
	};
}

function parseUbiName(name: string): string | undefined {
	if (!name.startsWith("ubi:")) return undefined;
	const repo = name.slice("ubi:".length);
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: invalid ubi spec "${name}" — expected "ubi:owner/repo".`,
		);
	}
	return repo;
}

function normalizeVersion(version: string | undefined): string {
	const v = (version ?? "latest").trim();
	return v.startsWith("v") ? v.slice(1) : v;
}

/** Returns the parsed tools, or a human-readable reason when there is nothing to install. */
async function readMiseToml(
	configFile: string | undefined,
	cwd: string,
): Promise<Record<string, ToolSpec> | string> {
	const candidates = configFile
		? [resolve(cwd, configFile)]
		: [join(cwd, "mise.toml"), join(cwd, ".mise.toml")];
	let text: string | undefined;
	let path: string | undefined;
	for (const candidate of candidates) {
		try {
			text = await readFile(candidate, "utf8");
			path = candidate;
			break;
		} catch {
			// try the next candidate
		}
	}
	if (text === undefined || path === undefined) {
		return `no mise config found (looked for ${candidates.join(", ")})`;
	}

	const { parse } = await import("smol-toml");
	const parsed = parse(text) as { tools?: Record<string, unknown> };
	const tools = parsed.tools;
	if (tools === undefined || Object.keys(tools).length === 0) {
		// A mise config without [tools] is normal (it may only carry [env] or
		// [tasks]) — nothing to install, not an error.
		return `${path} has no [tools] section`;
	}

	const result: Record<string, ToolSpec> = {};
	for (const [name, value] of Object.entries(tools)) {
		if (typeof value === "string") {
			result[name] = value;
		} else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			typeof (value as { version?: unknown }).version === "string"
		) {
			// mise table options (os, exe, postinstall, …) would change behavior we
			// don't implement — refuse rather than silently produce a different build.
			const extraKeys = Object.keys(value).filter((k) => k !== "version");
			if (extraKeys.length > 0) {
				throw new Error(
					`@neondatabase/esbuild-plugin-mise: tool "${name}" in ${path} uses option${extraKeys.length > 1 ? "s" : ""} ${extraKeys.map((k) => `\`${k}\``).join(", ")} that this plugin does not implement. Declare the tool in the plugin's \`tools\` option instead.`,
				);
			}
			result[name] = { version: (value as { version: string }).version };
		} else {
			throw new Error(
				`@neondatabase/esbuild-plugin-mise: unsupported value for tool "${name}" in ${path} — only \`name = "version"\` and \`name = { version = "..." }\` are supported.`,
			);
		}
	}
	return result;
}
