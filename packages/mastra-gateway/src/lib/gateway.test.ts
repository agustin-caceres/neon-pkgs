import { Mastra } from "@mastra/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNeonGateway, NeonGateway } from "./gateway.js";

const baseUrl = "https://br-test-api.ai.us-east-1.aws.neon.tech";

describe("NeonGateway", () => {
	beforeEach(() => {
		// Keep tests independent of any ambient Neon env configuration.
		vi.stubEnv("NEON_AI_GATEWAY_BASE_URL", "");
		vi.stubEnv("NEON_AI_GATEWAY_TOKEN", "");
	});

	describe("identity", () => {
		it("uses the neon gateway id and name", () => {
			const gateway = new NeonGateway();
			expect(gateway.id).toBe("neon");
			expect(gateway.getId()).toBe("neon");
			expect(gateway.name).toBe("Neon AI Gateway");
		});
	});

	describe("fetchProviders", () => {
		it("exposes the databricks catalog under the neon gateway", async () => {
			const providers = await new NeonGateway().fetchProviders();
			expect(providers.databricks).toBeDefined();
			expect(providers.databricks.gateway).toBe("neon");
			expect(providers.databricks.apiKeyEnvVar).toBe(
				"NEON_AI_GATEWAY_TOKEN",
			);
			expect(providers.databricks.models).toContain("claude-haiku-4-5");
			expect(providers.databricks.models).toContain("gpt-5-3-codex");
			expect(providers.databricks.models).toContain("gemini-2-5-flash");
		});
	});

	describe("shouldEnable", () => {
		it("is enabled only when both a base URL and token are present", () => {
			expect(new NeonGateway().shouldEnable()).toBe(false);
			expect(new NeonGateway({ apiKey: "nt_test" }).shouldEnable()).toBe(
				false,
			);
			expect(new NeonGateway({ baseUrl }).shouldEnable()).toBe(false);
			expect(
				new NeonGateway({ baseUrl, apiKey: "nt_test" }).shouldEnable(),
			).toBe(true);
		});

		it("reads configuration from the environment", () => {
			vi.stubEnv("NEON_AI_GATEWAY_BASE_URL", baseUrl);
			vi.stubEnv("NEON_AI_GATEWAY_TOKEN", "nt_env");
			expect(new NeonGateway().shouldEnable()).toBe(true);
		});
	});

	describe("getApiKey", () => {
		it("returns the configured token", async () => {
			const gateway = new NeonGateway({ apiKey: "nt_configured" });
			expect(
				await gateway.getApiKey("neon/databricks/claude-haiku-4-5"),
			).toBe("nt_configured");
		});

		it("throws a descriptive error when the token is missing", async () => {
			await expect(
				new NeonGateway().getApiKey("neon/databricks/claude-haiku-4-5"),
			).rejects.toThrow("NEON_AI_GATEWAY_TOKEN");
		});
	});

	describe("buildUrl", () => {
		it("returns the branch-scoped base URL without a trailing slash", () => {
			const gateway = new NeonGateway({ baseUrl: `${baseUrl}/` });
			expect(gateway.buildUrl("neon/databricks/claude-haiku-4-5")).toBe(
				baseUrl,
			);
		});

		it("throws a descriptive error when the base URL is missing", () => {
			expect(() =>
				new NeonGateway().buildUrl("neon/databricks/x"),
			).toThrow("NEON_AI_GATEWAY_BASE_URL");
		});
	});

	describe("resolveLanguageModel routing", () => {
		const gateway = new NeonGateway({ baseUrl });
		const resolve = (modelId: string) =>
			gateway.resolveLanguageModel({
				modelId,
				providerId: "databricks",
				apiKey: "nt_test",
			});

		it("routes Claude models to the native (v3) Messages model", () => {
			const model = resolve("claude-haiku-4-5");
			expect(model.specificationVersion).toBe("v3");
			expect(model.modelId).toBe("databricks-claude-haiku-4-5");
		});

		it("routes GPT/Codex models to the native (v3) Responses model", () => {
			const model = resolve("gpt-5-3-codex");
			expect(model.specificationVersion).toBe("v3");
			expect(model.modelId).toBe("databricks-gpt-5-3-codex");
		});

		it("routes other models to the unified (v2) MLflow model", () => {
			expect(resolve("gemini-2-5-flash").specificationVersion).toBe("v2");
			expect(resolve("llama-4-maverick").specificationVersion).toBe("v2");
			// gpt-oss is open-weight and served on the unified endpoint.
			expect(resolve("gpt-oss-120b").specificationVersion).toBe("v2");
		});

		it("tolerates ids that already carry the databricks- prefix", () => {
			expect(resolve("databricks-claude-haiku-4-5").modelId).toBe(
				"databricks-claude-haiku-4-5",
			);
		});
	});

	it("createNeonGateway constructs a NeonGateway", () => {
		expect(createNeonGateway()).toBeInstanceOf(NeonGateway);
	});

	describe("Mastra registration", () => {
		it("registers under a Mastra instance and is retrievable by key and id", () => {
			const gateway = new NeonGateway({ baseUrl, apiKey: "nt_test" });
			const mastra = new Mastra({
				logger: false,
				gateways: { neon: gateway },
			});

			expect(mastra.getGateway("neon")).toBe(gateway);
			expect(mastra.getGatewayById("neon")).toBe(gateway);
			expect(mastra.listGateways()?.neon.name).toBe("Neon AI Gateway");
		});
	});
});
