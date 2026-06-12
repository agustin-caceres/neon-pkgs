import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	type GatewayLanguageModel,
	MastraModelGateway,
	type ProviderConfig,
} from "@mastra/core/llm";
import { transformNeonRequestBody } from "./neon-capabilities.js";
import {
	withAnthropicGatewayCompat,
	withMlflowCapabilities,
	withOpenAIForcedReasoning,
} from "./neon-language-models.js";
import { getNeonModelRoute } from "./neon-model-capabilities.js";
import {
	NEON_MODEL_SUFFIXES,
	NEON_PROVIDER_ID,
	toNeonModelId,
} from "./neon-models.js";
import { VERSION } from "./version.js";

const BASE_URL_ENV_VAR = "NEON_AI_GATEWAY_BASE_URL";
const TOKEN_ENV_VAR = "NEON_AI_GATEWAY_TOKEN";

export interface NeonGatewayConfig {
	/**
	 * Neon AI Gateway base URL — the branch-scoped host root, e.g.
	 * `https://<branch-id>-api.ai.<region>.aws.neon.tech`. Falls back to the
	 * `NEON_AI_GATEWAY_BASE_URL` env var.
	 */
	baseUrl?: string;

	/**
	 * Neon AI Gateway platform token (the `nt_live_...` value). Falls back to the
	 * `NEON_AI_GATEWAY_TOKEN` env var.
	 */
	apiKey?: string;

	/** Custom headers added to every gateway request. */
	headers?: Record<string, string>;
}

/**
 * Mastra model gateway for the branch-scoped Neon AI Gateway.
 *
 * Routes each model to the best gateway endpoint based on its id (Anthropic →
 * native Messages, OpenAI → native Responses incl. Codex, everything else →
 * unified MLflow), so a single `neon/databricks/<model>` id reaches the whole
 * catalog. Configure with the branch-scoped `NEON_AI_GATEWAY_BASE_URL` +
 * `NEON_AI_GATEWAY_TOKEN` emitted by `neonctl env pull` / `neon dev`, or pass
 * `baseUrl` / `apiKey` explicitly.
 *
 * @example
 * ```ts
 * import { Mastra } from "@mastra/core";
 * import { NeonGateway } from "@neondatabase/mastra-gateway";
 *
 * const mastra = new Mastra({ gateways: { neon: new NeonGateway() } });
 * // model: "neon/databricks/claude-haiku-4-5"
 * ```
 */
export class NeonGateway extends MastraModelGateway {
	readonly id = "neon";
	readonly name = "Neon AI Gateway";

	private readonly config: NeonGatewayConfig;

	constructor(config: NeonGatewayConfig = {}) {
		super();
		this.config = config;
	}

	override shouldEnable(): boolean {
		const hasToken = Boolean(
			this.config.apiKey ?? process.env[TOKEN_ENV_VAR],
		);
		const hasBaseUrl = Boolean(
			this.config.baseUrl ?? process.env[BASE_URL_ENV_VAR],
		);
		return hasToken && hasBaseUrl;
	}

	private getBaseUrl(): string {
		const raw = this.config.baseUrl ?? process.env[BASE_URL_ENV_VAR];
		if (!raw) {
			throw new Error(
				`Missing ${BASE_URL_ENV_VAR}. Set it to your branch-scoped Neon AI Gateway base URL (Neon Console → branch → AI Gateway) or pass \`baseUrl\` to \`new NeonGateway()\`.`,
			);
		}
		return raw.replace(/\/+$/, "");
	}

	async getApiKey(modelId: string): Promise<string> {
		const apiKey = this.config.apiKey ?? process.env[TOKEN_ENV_VAR];
		if (!apiKey) {
			throw new Error(
				`Missing ${TOKEN_ENV_VAR} required for model "${modelId}". Set it to your Neon AI Gateway token or pass \`apiKey\` to \`new NeonGateway()\`.`,
			);
		}
		return apiKey;
	}

	buildUrl(_modelId: string): string {
		return this.getBaseUrl();
	}

	async fetchProviders(): Promise<Record<string, ProviderConfig>> {
		return {
			[NEON_PROVIDER_ID]: {
				name: this.name,
				gateway: this.id,
				apiKeyEnvVar: TOKEN_ENV_VAR,
				apiKeyHeader: "Authorization",
				models: [...NEON_MODEL_SUFFIXES],
				docUrl: "https://neon.com/docs/ai/ai-gateway",
			},
		};
	}

	resolveLanguageModel({
		modelId,
		apiKey,
		headers,
	}: {
		modelId: string;
		providerId: string;
		apiKey: string;
		headers?: Record<string, string>;
	}): GatewayLanguageModel {
		const baseURL = this.getBaseUrl();
		const neonModelId = toNeonModelId(modelId);
		const mergedHeaders = {
			"User-Agent": `neondatabase/mastra-gateway/${VERSION}`,
			...this.config.headers,
			...headers,
		};

		switch (getNeonModelRoute(neonModelId)) {
			// Anthropic models -> native Messages API. The gateway authenticates via
			// `Authorization: Bearer <token>`, so use `authToken` (which sets that
			// header) instead of `apiKey` (which would send `x-api-key`).
			case "anthropic": {
				const model = createAnthropic({
					authToken: apiKey,
					baseURL: `${baseURL}/ai-gateway/anthropic/v1`,
					headers: {
						"anthropic-version": "2023-06-01",
						...mergedHeaders,
					},
				})(neonModelId);
				return withAnthropicGatewayCompat(model);
			}
			// OpenAI models (incl. Codex, only served natively) -> Responses API.
			case "openai": {
				const model = createOpenAI({
					apiKey,
					baseURL: `${baseURL}/ai-gateway/openai/v1`,
					headers: mergedHeaders,
				}).responses(neonModelId);
				return withOpenAIForcedReasoning(model, neonModelId);
			}
			// Everything else (Gemini, Llama, Qwen, gpt-oss, ...) -> unified MLflow
			// endpoint. Gemini is here because its native endpoint can't stream.
			default: {
				const model = createOpenAICompatible({
					name: "neon",
					apiKey,
					baseURL: `${baseURL}/ai-gateway/mlflow/v1`,
					headers: mergedHeaders,
					supportsStructuredOutputs: true,
					transformRequestBody: transformNeonRequestBody,
				}).chatModel(neonModelId);
				return withMlflowCapabilities(model, neonModelId);
			}
		}
	}

	override serializeForSpan(): {
		id: string;
		name: string;
		baseUrl?: string;
	} {
		const baseUrl = this.config.baseUrl ?? process.env[BASE_URL_ENV_VAR];
		return baseUrl
			? { id: this.id, name: this.name, baseUrl }
			: { id: this.id, name: this.name };
	}
}

/** Create a Neon AI Gateway model gateway for Mastra. */
export function createNeonGateway(config?: NeonGatewayConfig): NeonGateway {
	return new NeonGateway(config);
}
