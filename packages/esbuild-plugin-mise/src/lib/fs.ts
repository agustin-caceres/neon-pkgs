import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write via a unique temp file + rename so concurrent writers (parallel builds
 * sharing a cache dir) each produce a complete file and last-rename-wins.
 */
export async function writeFileAtomic(
	path: string,
	data: string | Uint8Array,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
	await writeFile(tmp, data);
	await rename(tmp, path);
}
