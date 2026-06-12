import type {
	LanguageModelV2,
	LanguageModelV2CallOptions,
} from "@ai-sdk/provider-v5";
import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
} from "@ai-sdk/provider-v6";
import {
	applyNeonCapabilities,
	mergeStreamStartWarnings,
} from "./neon-capabilities.js";

/**
 * Wrap an AI SDK v6 (`LanguageModelV3`) model, transforming the call options on
 * each `doGenerate` / `doStream` while delegating everything else. Used to inject
 * gateway-required provider option defaults for the native Anthropic and OpenAI
 * routes.
 */
function wrapV3(
	model: LanguageModelV3,
	transform: (
		options: LanguageModelV3CallOptions,
	) => LanguageModelV3CallOptions,
): LanguageModelV3 {
	return {
		specificationVersion: "v3",
		get provider() {
			return model.provider;
		},
		get modelId() {
			return model.modelId;
		},
		get supportedUrls() {
			return model.supportedUrls;
		},
		doGenerate: (options) => model.doGenerate(transform(options)),
		doStream: (options) => model.doStream(transform(options)),
	};
}

/**
 * Anthropic models served via the Neon AI Gateway's native Messages API.
 *
 * The shared Anthropic model defaults to fine-grained tool-input streaming
 * (`eager_input_streaming: true`) on streaming tool calls, which the gateway
 * rejects (`Extra inputs are not permitted`). We disable it via the model's own
 * `toolStreaming` provider option so streaming tool calls work. Users can still
 * override it explicitly.
 */
export function withAnthropicGatewayCompat(
	model: LanguageModelV3,
): LanguageModelV3 {
	return wrapV3(model, (options) => {
		const anthropic = options.providerOptions?.anthropic;
		// Respect an explicit user setting.
		if (anthropic != null && "toolStreaming" in anthropic) {
			return options;
		}
		return {
			...options,
			providerOptions: {
				...options.providerOptions,
				anthropic: { ...anthropic, toolStreaming: false },
			},
		};
	});
}

/**
 * OpenAI models served via the Neon AI Gateway's native Responses API.
 *
 * The shared OpenAI Responses model shapes a request based on whether the model
 * is a reasoning model, but it detects that from the bare model id (`gpt-5`),
 * which the gateway's required `databricks-` prefix defeats. For the GPT-5
 * reasoning family we set the model's own `forceReasoning` provider option so it
 * applies the correct reasoning behavior. Users can still override it.
 */
export function withOpenAIForcedReasoning(
	model: LanguageModelV3,
	neonModelId: string,
): LanguageModelV3 {
	if (!/gpt-5/.test(neonModelId.toLowerCase())) {
		return model;
	}
	return wrapV3(model, (options) => {
		const openai = options.providerOptions?.openai;
		// Respect an explicit user setting.
		if (openai != null && "forceReasoning" in openai) {
			return options;
		}
		return {
			...options,
			providerOptions: {
				...options.providerOptions,
				openai: { ...openai, forceReasoning: true },
			},
		};
	});
}

/**
 * Models served via the Neon AI Gateway unified (MLflow) endpoint.
 *
 * Wraps the OpenAI-compatible (`LanguageModelV2`) model to add per-model
 * capability handling: parameters an upstream backend is known to reject are
 * dropped and reported as `result.warnings` instead of failing the request.
 */
export function withMlflowCapabilities(
	model: LanguageModelV2,
	neonModelId: string,
): LanguageModelV2 {
	return {
		specificationVersion: "v2",
		get provider() {
			return model.provider;
		},
		get modelId() {
			return model.modelId;
		},
		get supportedUrls() {
			return model.supportedUrls;
		},
		async doGenerate(options: LanguageModelV2CallOptions) {
			const { options: adjusted, warnings } = applyNeonCapabilities(
				neonModelId,
				options,
			);
			const result = await model.doGenerate(adjusted);
			return warnings.length > 0
				? { ...result, warnings: [...warnings, ...result.warnings] }
				: result;
		},
		async doStream(options: LanguageModelV2CallOptions) {
			const { options: adjusted, warnings } = applyNeonCapabilities(
				neonModelId,
				options,
			);
			const result = await model.doStream(adjusted);
			return warnings.length > 0
				? {
						...result,
						stream: result.stream.pipeThrough(
							mergeStreamStartWarnings(warnings),
						),
					}
				: result;
		},
	};
}
