# @neondatabase/mastra-gateway

Community [Mastra](https://mastra.ai) model gateway for the [Neon](https://neon.com) AI Gateway.

The Neon AI Gateway is **branch-scoped**: each Neon project branch gets its own gateway host, and a platform token authorizes requests for that branch. This gateway routes each model to the best gateway endpoint (Anthropic → native Messages, OpenAI → native Responses incl. **Codex**, everything else → unified OpenAI-compatible MLflow endpoint), so a single `neon/databricks/<model>` id reaches the whole `databricks-*` catalog.

It is the Mastra counterpart to [`@neondatabase/ai-sdk-provider`](../ai-sdk-provider) and makes the same routing and parameter decisions, exposed through Mastra's [custom model gateway](https://mastra.ai/models/gateways/custom-gateways) interface.

## Install

```bash
npm install @neondatabase/mastra-gateway
```

`@mastra/core` is a peer dependency.

## Configuration

The gateway URL is branch-scoped, so both values come from the Neon Console (your project → a branch → **AI Gateway** tab), or from `neonctl env pull` / `neon dev`:

```bash
NEON_AI_GATEWAY_BASE_URL="https://<branch-id>-api.ai.<region>.aws.neon.tech"
NEON_AI_GATEWAY_TOKEN="nt_live_..."
```

## Usage

Register the gateway on your Mastra instance, then reference models as `neon/databricks/<model>`:

```ts
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { NeonGateway } from "@neondatabase/mastra-gateway";

const agent = new Agent({
  name: "assistant",
  instructions: "You are a helpful assistant.",
  model: "neon/databricks/claude-haiku-4-5", // or "neon/databricks/gpt-5-3-codex", etc.
});

// Reads NEON_AI_GATEWAY_BASE_URL + NEON_AI_GATEWAY_TOKEN from the environment.
export const mastra = new Mastra({
  gateways: { neon: new NeonGateway() },
  agents: { assistant: agent },
});
```

Or configure explicitly instead of reading from the environment:

```ts
import { NeonGateway } from "@neondatabase/mastra-gateway";

const neon = new NeonGateway({
  baseUrl: process.env.NEON_AI_GATEWAY_BASE_URL,
  apiKey: process.env.NEON_AI_GATEWAY_TOKEN,
});
```

### Model ids

Models use Mastra's `gateway/provider/model` format: `neon/databricks/<model>`, where `<model>` is the Neon model id without the `databricks-` prefix (e.g. `neon/databricks/claude-haiku-4-5`). An id that already carries the `databricks-` prefix is accepted too. The `NeonGatewayModelId` type provides autocomplete for the known catalog.

## Routing

| Model family | Endpoint | Why |
| --- | --- | --- |
| Anthropic (`claude-*`) | native Messages API | streaming structured output + native reasoning |
| OpenAI (`gpt-*`, `*-codex`) | native Responses API | Codex (native-only), native reasoning, image-gen tool |
| Everything else (Gemini, Llama, Qwen, gpt-oss, ...) | unified MLflow endpoint | broad coverage; Gemini is here because its native endpoint does not support streaming |

## Capabilities

For MLflow-routed models, the gateway detects the model family and drops parameters a backend rejects (e.g. penalties/`seed` for Llama, `reasoningEffort` for Gemini) with a warning (`result.warnings`) instead of failing the request. It also strips the JSON Schema `$schema` marker from tool/structured-output schemas, which some backends (notably Gemini) reject.

For the native routes it applies the gateway-required defaults from `@neondatabase/ai-sdk-provider`: Anthropic streaming tool calls disable fine-grained tool-input streaming (`toolStreaming: false`), and the GPT‑5 family forces reasoning behavior (`forceReasoning`) that the `databricks-` prefix would otherwise defeat. Both can be overridden via provider options.

## Limitations

- Embeddings and `generateImage()`-style image models are not offered by the gateway.
- `gpt-oss-*` models return a non-standard ("harmony") response shape on the unified endpoint and are not fully supported.

## Versioning

Import from `@neondatabase/mastra-gateway/v1` to pin to a specific major. The default entry re-exports the latest stable version.
