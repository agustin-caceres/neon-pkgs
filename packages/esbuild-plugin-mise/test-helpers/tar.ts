/** Minimal ustar writer for test fixtures — mirrors what release tarballs contain. */
export interface TarEntry {
	name: string;
	data: Uint8Array;
	mode?: number;
	/** Tar typeflag character; defaults to "0" (regular file). */
	typeflag?: string;
}

/** Encode a pax extended-header record set (e.g. `{ path: "..." }`) as the body of a typeflag-"x" entry. */
export function paxRecords(records: Record<string, string>): Uint8Array {
	let out = "";
	for (const [key, value] of Object.entries(records)) {
		const content = ` ${key}=${value}\n`;
		// The length prefix counts the whole record including its own digits —
		// iterate to a fixed point in case adding the digits grows the digit count.
		let length = content.length;
		let prev = 0;
		while (prev !== length) {
			prev = length;
			length = content.length + String(prev).length;
		}
		out += `${length}${content}`;
	}
	return new TextEncoder().encode(out);
}

const BLOCK = 512;

export function makeTar(entries: TarEntry[]): Uint8Array {
	const blocks: Uint8Array[] = [];
	for (const entry of entries) {
		const header = new Uint8Array(BLOCK);
		writeString(header, 0, entry.name);
		writeString(
			header,
			100,
			(entry.mode ?? 0o644).toString(8).padStart(7, "0"),
		);
		writeString(header, 108, "0000000"); // uid
		writeString(header, 116, "0000000"); // gid
		writeString(
			header,
			124,
			entry.data.length.toString(8).padStart(11, "0"),
		);
		writeString(header, 136, "00000000000"); // mtime
		header[156] = (entry.typeflag ?? "0").charCodeAt(0);
		writeString(header, 257, "ustar");
		header[262] = 0;
		writeString(header, 263, "00");

		// Checksum: computed with the chksum field set to spaces.
		for (let i = 148; i < 156; i++) header[i] = 0x20;
		let sum = 0;
		for (const byte of header) sum += byte;
		writeString(header, 148, `${sum.toString(8).padStart(6, "0")}\0 `);

		blocks.push(header);
		const padded = new Uint8Array(
			Math.ceil(entry.data.length / BLOCK) * BLOCK,
		);
		padded.set(entry.data);
		blocks.push(padded);
	}
	blocks.push(new Uint8Array(BLOCK * 2)); // end-of-archive marker

	const total = blocks.reduce((n, b) => n + b.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const block of blocks) {
		out.set(block, offset);
		offset += block.length;
	}
	return out;
}

function writeString(target: Uint8Array, offset: number, text: string): void {
	const bytes = new TextEncoder().encode(text);
	target.set(bytes, offset);
}
