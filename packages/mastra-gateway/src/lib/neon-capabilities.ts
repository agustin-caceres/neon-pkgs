import type {
	LanguageModelV2CallOptions,
	LanguageModelV2CallWarning,
	LanguageModelV2StreamPart,
	SharedV2ProviderOptions,
} from "@ai-sdk/provider-v5";
import { getNeonModelCapabilities } from "./neon-model-capabilities.js";

/**
 * Recursively remove the JSON Schema `$schema` marker, which some gateway
 * backends (notably Gemini) reject in tool/structured-output schemas. Other
 * backends ignore its absence, so stripping it everywhere is safe.
 */
export function stripJsonSchemaMarker(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stripJsonSchemaMarker);
	}
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (key === "$schema") {
				continue;
			}
			result[key] = stripJsonSchemaMarker(entry);
		}
		return result;
	}
	return value;
}

/**
 * Strip the `$schema` marker from the `tools` and `response_format` fields of an
 * MLflow request body before it is sent to the gateway. Passed to the
 * OpenAI-compatible model via `transformRequestBody`.
 */
export function transformNeonRequestBody(
	args: Record<string, unknown>,
): Record<string, unknown> {
	const transformed = { ...args };
	if (transformed.tools != null) {
		transformed.tools = stripJsonSchemaMarker(transformed.tools);
	}
	if (transformed.response_format != null) {
		transformed.response_format = stripJsonSchemaMarker(
			transformed.response_format,
		);
	}
	return transformed;
}

type DroppableSetting =
	| "temperature"
	| "topP"
	| "frequencyPenalty"
	| "presencePenalty"
	| "seed"
	| "stopSequences";

/**
 * Drop call options the resolved MLflow model's upstream backend does not accept
 * and collect a warning for each, so callers get a clear signal (via
 * `result.warnings`) instead of a hard `400` from the gateway.
 */
export function applyNeonCapabilities(
	modelId: string,
	options: LanguageModelV2CallOptions,
): {
	options: LanguageModelV2CallOptions;
	warnings: LanguageModelV2CallWarning[];
} {
	const caps = getNeonModelCapabilities(modelId);
	const warnings: LanguageModelV2CallWarning[] = [];
	const patch: Partial<LanguageModelV2CallOptions> = {};

	const dropSetting = (setting: DroppableSetting) => {
		warnings.push({
			type: "unsupported-setting",
			setting,
			details: `${setting} is not supported by the Neon AI Gateway for ${caps.family} model "${modelId}" and was dropped.`,
		});
	};

	if (options.temperature != null && !caps.supportsTemperature) {
		patch.temperature = undefined;
		dropSetting("temperature");
	}
	if (options.topP != null && !caps.supportsTopP) {
		patch.topP = undefined;
		dropSetting("topP");
	}

	// Anthropic-style models accept only one of temperature / topP.
	const effectiveTemperature =
		"temperature" in patch ? patch.temperature : options.temperature;
	const effectiveTopP = "topP" in patch ? patch.topP : options.topP;
	if (
		caps.temperatureTopPMutuallyExclusive &&
		effectiveTemperature != null &&
		effectiveTopP != null
	) {
		patch.topP = undefined;
		warnings.push({
			type: "unsupported-setting",
			setting: "topP",
			details: `${caps.family} models accept only one of temperature or topP; topP was dropped.`,
		});
	}

	if (options.frequencyPenalty != null && !caps.supportsPenalties) {
		patch.frequencyPenalty = undefined;
		dropSetting("frequencyPenalty");
	}
	if (options.presencePenalty != null && !caps.supportsPenalties) {
		patch.presencePenalty = undefined;
		dropSetting("presencePenalty");
	}
	if (options.seed != null && !caps.supportsSeed) {
		patch.seed = undefined;
		dropSetting("seed");
	}
	if (options.stopSequences != null && !caps.supportsStopSequences) {
		patch.stopSequences = undefined;
		dropSetting("stopSequences");
	}

	// `reasoning_effort` is carried in provider options
	// (`providerOptions.openai.reasoningEffort`, etc.), not as a top-level call
	// option. Drop it for families that reject it (e.g. Gemini).
	if (!caps.supportsReasoningEffort && options.providerOptions != null) {
		const hasProviderEffort = Object.values(options.providerOptions).some(
			(group) =>
				group != null &&
				"reasoningEffort" in group &&
				group.reasoningEffort != null,
		);
		if (hasProviderEffort) {
			const cleaned: SharedV2ProviderOptions = {};
			for (const [key, group] of Object.entries(
				options.providerOptions,
			)) {
				if (group != null && "reasoningEffort" in group) {
					const { reasoningEffort: _removed, ...rest } = group;
					cleaned[key] = rest;
				} else {
					cleaned[key] = group;
				}
			}
			patch.providerOptions = cleaned;
			warnings.push({
				type: "other",
				message: `reasoningEffort is not supported by the Neon AI Gateway for ${caps.family} model "${modelId}" and was dropped.`,
			});
		}
	}

	if (Object.keys(patch).length === 0) {
		return { options, warnings };
	}
	return { options: { ...options, ...patch }, warnings };
}

/**
 * Merge additional warnings into the `stream-start` part of a model stream.
 */
export function mergeStreamStartWarnings(extra: LanguageModelV2CallWarning[]) {
	let merged = false;
	return new TransformStream<
		LanguageModelV2StreamPart,
		LanguageModelV2StreamPart
	>({
		transform(part, controller) {
			if (!merged && part.type === "stream-start") {
				merged = true;
				controller.enqueue({
					...part,
					warnings: [...extra, ...part.warnings],
				});
			} else {
				controller.enqueue(part);
			}
		},
	});
}
