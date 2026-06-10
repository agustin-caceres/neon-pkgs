import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./fs.js";
import type { Platform } from "./types.js";

export interface ReleaseAsset {
	name: string;
	url: string;
}

export interface Release {
	/** Version with any leading `v` / tag prefix stripped. */
	version: string;
	assets: ReleaseAsset[];
}

/**
 * Fetch release metadata for a tool from the GitHub API. Pinned versions are
 * cached on disk and treated as immutable (re-tagged releases require clearing
 * the cache dir); `latest` always hits the API so builds pick up new releases.
 * Set `GITHUB_TOKEN` to lift the anonymous API rate limit in CI.
 */
export async function fetchRelease(
	repo: string,
	version: string,
	tagPrefix: string | undefined,
	cacheDir: string,
): Promise<Release> {
	if (version === "latest") {
		const release = await fetchReleaseJson(
			`https://api.github.com/repos/${repo}/releases/latest`,
		);
		if (release === undefined) {
			throw new Error(
				`@neondatabase/esbuild-plugin-mise: no releases found for ${repo}.`,
			);
		}
		return toRelease(release, tagPrefix);
	}

	const tags = tagPrefix
		? [`${tagPrefix}${version}`]
		: [`v${version}`, version];
	for (const tag of tags) {
		const cachePath = join(
			cacheDir,
			"releases",
			`${repo.replace("/", "__")}--${tag}.json`,
		);
		const cached = await readJsonIfExists(cachePath);
		if (cached !== undefined) return toRelease(cached, tagPrefix);

		const release = await fetchReleaseJson(
			`https://api.github.com/repos/${repo}/releases/tags/${tag}`,
		);
		if (release !== undefined) {
			await writeFileAtomic(cachePath, JSON.stringify(release));
			return toRelease(release, tagPrefix);
		}
	}
	throw new Error(
		`@neondatabase/esbuild-plugin-mise: release ${tags.map((t) => `"${t}"`).join(" / ")} not found for ${repo}. If the project uses a non-standard tag scheme, set \`tagPrefix\`.`,
	);
}

interface GithubRelease {
	tag_name: string;
	assets: { name: string; browser_download_url: string }[];
}

async function fetchReleaseJson(
	url: string,
): Promise<GithubRelease | undefined> {
	const headers: Record<string, string> = {
		accept: "application/vnd.github+json",
		"user-agent": "@neondatabase/esbuild-plugin-mise",
	};
	const token = process.env.GITHUB_TOKEN;
	if (token) headers.authorization = `Bearer ${token}`;

	const res = await fetch(url, { headers });
	if (res.status === 404) return undefined;
	if (!res.ok) {
		const rateLimited = res.status === 403 || res.status === 429;
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: GitHub API request failed (${res.status} ${res.statusText}) for ${url}.${rateLimited ? " You may be rate-limited — set GITHUB_TOKEN." : ""}`,
		);
	}
	return (await res.json()) as GithubRelease;
}

function toRelease(release: GithubRelease, tagPrefix?: string): Release {
	let version = release.tag_name;
	if (tagPrefix && version.startsWith(tagPrefix)) {
		version = version.slice(tagPrefix.length);
	}
	if (version.startsWith("v")) version = version.slice(1);
	return {
		version,
		assets: release.assets.map((a) => ({
			name: a.name,
			url: a.browser_download_url,
		})),
	};
}

async function readJsonIfExists(
	path: string,
): Promise<GithubRelease | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as GithubRelease;
	} catch {
		return undefined;
	}
}

const OS_PATTERNS: Record<string, RegExp> = {
	linux: /linux/i,
	darwin: /darwin|macos|mac-?os|osx|apple/i,
};

const ARCH_PATTERNS: Record<string, RegExp> = {
	x64: /x86[_-]?64|amd64|x64|universal/i,
	arm64: /arm64|aarch64|universal/i,
};

/** Checksums, signatures, packages, source archives, and formats we can't extract. */
const REJECT_PATTERN =
	/\.(sha\d*(sum)?|sig|asc|pem|sbom|txt|md|json|deb|rpm|apk|msi|exe|dmg|pkg|appimage|tar\.(xz|bz2|zst)|txz|tbz2|tzst|xz|bz2|zst|7z)$|checksums|\bsrc\b|\bsource\b/i;

/**
 * Pick the release asset for a platform, ubi-style: require an OS marker,
 * require an arch marker when any asset has one, prefer static (musl) builds
 * and well-known archive formats. An `assetHint` that narrows the list to a
 * single asset is trusted entirely (it overrides the reject list too — the
 * user's word beats the heuristics); otherwise it acts as a hard filter.
 */
export function selectAsset(
	assets: ReleaseAsset[],
	platform: Platform,
	assetHint?: string,
): ReleaseAsset {
	const [os, arch] = platform.split("-") as [string, string];
	const osRe = OS_PATTERNS[os];
	const archRe = ARCH_PATTERNS[arch];

	let pool = assets;
	if (assetHint !== undefined) {
		pool = pool.filter((a) => a.name.includes(assetHint));
		if (pool.length === 1) return pool[0];
	}
	pool = pool.filter((a) => !REJECT_PATTERN.test(a.name));
	const osMatches = pool.filter((a) => osRe.test(a.name));
	const anyArchMarked = osMatches.some(
		(a) =>
			ARCH_PATTERNS.x64.test(a.name) || ARCH_PATTERNS.arm64.test(a.name),
	);
	const candidates = anyArchMarked
		? osMatches.filter((a) => archRe.test(a.name))
		: osMatches;

	if (candidates.length === 0) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: no release asset matches ${platform}${assetHint ? ` (hint "${assetHint}")` : ""}. Assets: ${assets.map((a) => a.name).join(", ") || "(none)"}. Use the \`asset\` option to pick one explicitly.`,
		);
	}

	const score = (a: ReleaseAsset): number =>
		(/musl/i.test(a.name) ? 4 : 0) +
		(/static/i.test(a.name) ? 2 : 0) +
		(/\.(tar\.gz|tgz|zip|gz)$/i.test(a.name) ? 1 : 0);
	candidates.sort(
		(a, b) => score(b) - score(a) || a.name.length - b.name.length,
	);
	return candidates[0];
}
