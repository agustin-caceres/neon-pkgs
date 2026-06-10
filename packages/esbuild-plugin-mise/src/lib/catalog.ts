/**
 * Built-in short names for common CLI tools, mapping to their GitHub releases
 * (mise's `ubi` backend shape). Anything not listed here can still be used via
 * an explicit `ubi: "owner/repo"` or `url` spec — the catalog is a convenience,
 * not a registry.
 */
export interface CatalogEntry {
	repo: string;
	bin?: string;
	asset?: string;
	tagPrefix?: string;
}

export const CATALOG: Record<string, CatalogEntry> = {
	ripgrep: { repo: "BurntSushi/ripgrep", bin: "rg" },
	rg: { repo: "BurntSushi/ripgrep", bin: "rg" },
	jq: { repo: "jqlang/jq", tagPrefix: "jq-" },
	fd: { repo: "sharkdp/fd" },
	bat: { repo: "sharkdp/bat" },
	gh: { repo: "cli/cli", bin: "gh" },
	yq: { repo: "mikefarah/yq" },
};
