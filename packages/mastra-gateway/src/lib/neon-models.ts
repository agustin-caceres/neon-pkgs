// The Neon AI Gateway exposes a single flat catalog of `databricks-*` models.
// In Mastra's model-router id format (`gateway/provider/model`), these become
// `neon/databricks/<model>` where `<model>` is the Neon id without the
// `databricks-` prefix, e.g. `neon/databricks/claude-haiku-4-5`.
//
// The authoritative, always-current catalog is shown in the Neon Console under
// the branch's "AI Gateway" tab. Any other id can still be passed as a plain
// string via the `(string & {})` fallback on `NeonGatewayModelId`.

/** Mastra provider segment for all Neon AI Gateway models. */
export const NEON_PROVIDER_ID = "databricks" as const;

/** Model ids (without the `databricks-` prefix) served by the Neon AI Gateway. */
export const NEON_MODEL_SUFFIXES = [
	// Anthropic (native Messages API)
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-opus-4-5",
	"claude-opus-4-1",
	"claude-sonnet-4-6",
	"claude-sonnet-4-5",
	"claude-sonnet-4",
	"claude-haiku-4-5",
	// OpenAI (native Responses API, incl. Codex)
	"gpt-5",
	"gpt-5-mini",
	"gpt-5-nano",
	"gpt-5-1",
	"gpt-5-2",
	"gpt-5-2-codex",
	"gpt-5-3-codex",
	"gpt-5-4",
	"gpt-5-4-mini",
	"gpt-5-4-nano",
	"gpt-5-5",
	"gpt-5-5-pro",
	// OpenAI open-weight (unified MLflow endpoint)
	"gpt-oss-120b",
	"gpt-oss-20b",
	// Google (unified MLflow endpoint)
	"gemini-3-5-flash",
	"gemini-3-1-flash-lite",
	"gemini-2-5-pro",
	"gemini-2-5-flash",
	"gemma-3-12b",
	// Meta (unified MLflow endpoint)
	"llama-4-maverick",
	"meta-llama-3-3-70b-instruct",
	"meta-llama-3-1-8b-instruct",
	// Alibaba (unified MLflow endpoint)
	"qwen3-next-80b-a3b-instruct",
	"qwen35-122b-a10b",
] as const;

export type NeonModelSuffix = (typeof NEON_MODEL_SUFFIXES)[number];

/**
 * Mastra model-router id for a Neon AI Gateway model. The known catalog gives
 * autocomplete; the `(string & {})` fallback keeps any other id assignable.
 */
export type NeonGatewayModelId =
	| `neon/${typeof NEON_PROVIDER_ID}/${NeonModelSuffix}`
	| (string & {});

/**
 * Reconstruct the upstream Neon model id (`databricks-...`) from the model
 * segment Mastra's router parsed out of `neon/databricks/<model>`. Tolerates an
 * id that already carries the `databricks-` prefix.
 */
export function toNeonModelId(modelId: string): string {
	return modelId.startsWith(`${NEON_PROVIDER_ID}-`)
		? modelId
		: `${NEON_PROVIDER_ID}-${modelId}`;
}
