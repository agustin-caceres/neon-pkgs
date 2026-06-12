/**
 * `@neondatabase/mastra-gateway/v1` — community Mastra model gateway for the
 * Neon AI Gateway.
 *
 * - `NeonGateway` / `createNeonGateway()` — the gateway. Register it on a Mastra
 *   instance (`new Mastra({ gateways: { neon: new NeonGateway() } })`) and
 *   reference models as `neon/databricks/<model>`. Routes each model to the best
 *   gateway endpoint (Anthropic → native Messages, OpenAI → native Responses
 *   incl. Codex, everything else → unified MLflow).
 */
export {
	createNeonGateway,
	NeonGateway,
	type NeonGatewayConfig,
} from "./lib/gateway.js";
export {
	getNeonModelCapabilities,
	getNeonModelRoute,
	type NeonModelCapabilities,
	type NeonModelFamily,
	type NeonModelRoute,
} from "./lib/neon-model-capabilities.js";
export {
	NEON_MODEL_SUFFIXES,
	NEON_PROVIDER_ID,
	type NeonGatewayModelId,
	type NeonModelSuffix,
	toNeonModelId,
} from "./lib/neon-models.js";
