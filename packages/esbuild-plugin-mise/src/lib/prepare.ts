import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractBinary } from "./extract.js";
import { writeFileAtomic } from "./fs.js";
import { fetchRelease, selectAsset } from "./github.js";
import type { BakedTool, Platform, ResolvedToolSpec } from "./types.js";

export interface PreparedFile {
	platform: Platform;
	bin: string;
	data: Uint8Array;
}

export interface PreparedTools {
	tools: BakedTool[];
	files: PreparedFile[];
}

/**
 * Resolve versions, then download and extract every tool for every target
 * platform. Extracted binaries are cached by download URL under `cacheDir`, so
 * repeat builds are offline and fast.
 */
export async function prepareTools(
	specs: ResolvedToolSpec[],
	platforms: Platform[],
	cacheDir: string,
): Promise<PreparedTools> {
	const prepared = await Promise.all(
		specs.map((spec) => prepareTool(spec, platforms, cacheDir)),
	);
	return {
		tools: prepared.map((p) => p.tool),
		files: prepared.flatMap((p) => p.files),
	};
}

async function prepareTool(
	spec: ResolvedToolSpec,
	platforms: Platform[],
	cacheDir: string,
): Promise<{ tool: BakedTool; files: PreparedFile[] }> {
	let version = spec.version;
	let urls: { platform: Platform; url: string; assetName: string }[];

	if (spec.source.type === "github") {
		const release = await fetchRelease(
			spec.source.repo,
			spec.version,
			spec.source.tagPrefix,
			cacheDir,
		);
		version = release.version;
		urls = platforms.map((platform) => {
			const asset = selectAsset(release.assets, platform, spec.asset);
			return { platform, url: asset.url, assetName: asset.name };
		});
	} else {
		const { template, targets } = spec.source;
		urls = platforms.map((platform) => {
			const [os, arch] = platform.split("-");
			const target = targets?.[platform];
			if (template.includes("{target}") && target === undefined) {
				throw new Error(
					`@neondatabase/esbuild-plugin-mise: tool "${spec.name}" has no \`targets\` entry for ${platform}.`,
				);
			}
			const url = template
				.replaceAll("{version}", version)
				.replaceAll("{os}", os)
				.replaceAll("{arch}", arch)
				.replaceAll("{target}", target ?? "");
			return { platform, url, assetName: assetNameFromUrl(url) };
		});
	}

	const files = await Promise.all(
		urls.map(async ({ platform, url, assetName }) => ({
			platform,
			bin: spec.bin,
			data: await downloadBinary(url, assetName, spec.bin, cacheDir),
		})),
	);
	// Per-platform content hashes ride along in the manifest, so the runtime's
	// staging key changes whenever the actual bytes do — two apps shipping
	// different binaries under the same name/version never share a staging dir.
	const hashes = Object.fromEntries(
		files.map((f) => [f.platform, sha256(f.data)]),
	);
	return { tool: { name: spec.name, version, bin: spec.bin, hashes }, files };
}

/** Last path segment with any query string / fragment stripped. */
function assetNameFromUrl(url: string): string {
	const path = url.split(/[?#]/, 1)[0];
	return path.split("/").at(-1) ?? path;
}

async function downloadBinary(
	url: string,
	assetName: string,
	bin: string,
	cacheDir: string,
): Promise<Uint8Array> {
	const cachePath = join(cacheDir, "bins", sha256(url), bin);
	try {
		return await readFile(cachePath);
	} catch {
		// cache miss — download below
	}

	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: download failed (${res.status} ${res.statusText}) for ${url}.`,
		);
	}
	const binary = await extractBinary(
		new Uint8Array(await res.arrayBuffer()),
		assetName,
		bin,
	);

	await writeFileAtomic(cachePath, binary);
	return binary;
}

function sha256(data: string | Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}
