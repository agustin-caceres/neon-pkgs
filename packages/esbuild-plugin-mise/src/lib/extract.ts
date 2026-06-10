import { gunzipSync } from "node:zlib";

export interface ArchiveFile {
	/** Path inside the archive, `/`-separated. */
	name: string;
	data: Uint8Array;
	/** Unix mode when the format carries one (tar); otherwise 0. */
	mode: number;
}

/** Compression formats we have no decoder for — fail loudly instead of shipping the compressed bytes as a "binary". */
const UNSUPPORTED_ARCHIVE_PATTERN =
	/\.(tar\.(xz|bz2|zst)|txz|tbz2|tzst|xz|bz2|zst|7z)$/i;

/**
 * Pull the named executable out of a downloaded release asset. Handles
 * `.tar.gz`/`.tgz`, `.zip`, bare `.gz`, and raw binaries (assets like
 * `jq-linux-arm64` that *are* the executable).
 */
export async function extractBinary(
	data: Uint8Array,
	assetName: string,
	bin: string,
): Promise<Uint8Array> {
	if (/\.(tar\.gz|tgz)$/i.test(assetName)) {
		return findBinary(untar(gunzipSync(data)), bin, assetName);
	}
	if (/\.zip$/i.test(assetName)) {
		const { unzipSync } = await import("fflate");
		const entries = Object.entries(unzipSync(data))
			.filter(([name]) => !name.endsWith("/"))
			.map(([name, content]) => ({ name, data: content, mode: 0 }));
		return findBinary(entries, bin, assetName);
	}
	if (UNSUPPORTED_ARCHIVE_PATTERN.test(assetName)) {
		throw new Error(
			`@neondatabase/esbuild-plugin-mise: cannot extract ${assetName} — only .tar.gz/.tgz, .zip, .gz, and raw binaries are supported. Use the \`asset\` option to pick a different release asset.`,
		);
	}
	if (/\.gz$/i.test(assetName)) {
		return gunzipSync(data);
	}
	// No archive extension: the asset is the binary itself.
	return data;
}

function findBinary(
	files: ArchiveFile[],
	bin: string,
	assetName: string,
): Uint8Array {
	const nonEmpty = files.filter((f) => f.data.length > 0);
	const basename = (f: ArchiveFile) => f.name.split("/").at(-1) ?? f.name;
	const isExecutable = (f: ArchiveFile) => (f.mode & 0o111) !== 0;
	// Prefer an executable entry, then the shallowest path, then the shortest name.
	const best = (candidates: ArchiveFile[]): ArchiveFile =>
		[...candidates].sort(
			(a, b) =>
				Number(isExecutable(b)) - Number(isExecutable(a)) ||
				a.name.split("/").length - b.name.split("/").length ||
				basename(a).length - basename(b).length,
		)[0];

	const exact = nonEmpty.filter((f) => basename(f) === bin);
	if (exact.length > 0) return best(exact).data;

	// Per-platform binary names (`yq_linux_amd64` for bin `yq`): accept a prefix
	// match, narrowed to executable entries when the archive carries modes.
	let prefixed = nonEmpty.filter((f) => basename(f).startsWith(bin));
	if (prefixed.some(isExecutable)) prefixed = prefixed.filter(isExecutable);
	if (prefixed.length === 1) return prefixed[0].data;

	if (nonEmpty.length === 1) return nonEmpty[0].data;
	const executables = nonEmpty.filter(isExecutable);
	if (executables.length === 1) return executables[0].data;

	throw new Error(
		`@neondatabase/esbuild-plugin-mise: no file named "${bin}" in ${assetName}. Archive contents: ${files.map((f) => f.name).join(", ") || "(empty)"}. Set the \`bin\` option to the executable's name inside the archive.`,
	);
}

const BLOCK = 512;

/**
 * Tar reader covering what single-binary release tarballs use in practice:
 * ustar regular files, GNU long names ('L'), and pax `path` overrides ('x').
 * Anything it can't represent (symlinked binaries, sparse files) is simply
 * absent from the result, and surfaces as findBinary's archive-listing error.
 */
export function untar(data: Uint8Array): ArchiveFile[] {
	const files: ArchiveFile[] = [];
	let offset = 0;
	let overrideName: string | undefined;

	while (offset + BLOCK <= data.length) {
		const header = data.subarray(offset, offset + BLOCK);
		if (header.every((b) => b === 0)) break;

		const size = parseOctal(header, 124, 12);
		const typeflag = header[156];
		offset += BLOCK;
		const body = data.subarray(offset, offset + size);
		offset += Math.ceil(size / BLOCK) * BLOCK;

		// 'L': GNU long name — the body is the next entry's path.
		if (typeflag === 0x4c) {
			overrideName = readString(body, 0, size);
			continue;
		}
		// 'x': pax extended header — a `path` record overrides the next entry's path.
		if (typeflag === 0x78) {
			overrideName = parsePaxPath(body) ?? overrideName;
			continue;
		}
		// '0' or NUL: regular file.
		if (typeflag === 0x30 || typeflag === 0) {
			const prefix = readString(header, 345, 155);
			const shortName = readString(header, 0, 100);
			const name =
				overrideName ?? (prefix ? `${prefix}/${shortName}` : shortName);
			files.push({
				name,
				data: body,
				mode: parseOctal(header, 100, 8),
			});
		}
		overrideName = undefined;
	}
	return files;
}

/**
 * Pax body is a sequence of `<len> <key>=<value>\n` records where `<len>` is
 * the byte length of the whole record. Returns the `path` value, if any.
 */
function parsePaxPath(body: Uint8Array): string | undefined {
	let offset = 0;
	while (offset < body.length) {
		const space = body.indexOf(0x20, offset);
		if (space === -1) return undefined;
		const length = Number.parseInt(
			new TextDecoder().decode(body.subarray(offset, space)),
			10,
		);
		if (!Number.isFinite(length) || length <= 0) return undefined;
		const record = new TextDecoder().decode(
			body.subarray(space + 1, offset + length),
		);
		const eq = record.indexOf("=");
		if (eq !== -1 && record.slice(0, eq) === "path") {
			return record.slice(eq + 1).replace(/\n$/, "");
		}
		offset += length;
	}
	return undefined;
}

function readString(data: Uint8Array, start: number, length: number): string {
	const slice = data.subarray(start, start + length);
	const end = slice.indexOf(0);
	return new TextDecoder().decode(
		end === -1 ? slice : slice.subarray(0, end),
	);
}

function parseOctal(data: Uint8Array, start: number, length: number): number {
	const text = readString(data, start, length).trim();
	return text ? Number.parseInt(text, 8) : 0;
}
