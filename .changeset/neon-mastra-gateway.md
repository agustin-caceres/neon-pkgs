---
"@neondatabase/mastra-gateway": minor
---

Add `@neondatabase/mastra-gateway`: a community Mastra model gateway for the branch-scoped Neon AI Gateway. Register `new NeonGateway()` on a Mastra instance and reference models as `neon/databricks/<model>`. Routes each model to the best gateway endpoint (Anthropic → native Messages, OpenAI → native Responses incl. Codex, everything else → unified MLflow), mirroring `@neondatabase/ai-sdk-provider`.
