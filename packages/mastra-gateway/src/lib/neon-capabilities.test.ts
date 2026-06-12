import type { LanguageModelV2CallOptions } from "@ai-sdk/provider-v5";
import { describe, expect, it } from "vitest";
import {
	applyNeonCapabilities,
	stripJsonSchemaMarker,
	transformNeonRequestBody,
} from "./neon-capabilities.js";

function callOptions(
	overrides: Partial<LanguageModelV2CallOptions>,
): LanguageModelV2CallOptions {
	return { prompt: [], ...overrides };
}

describe("applyNeonCapabilities", () => {
	it("drops penalties and seed for Llama models with warnings", () => {
		const { options, warnings } = applyNeonCapabilities(
			"databricks-llama-4-maverick",
			callOptions({
				frequencyPenalty: 0.5,
				presencePenalty: 0.5,
				seed: 7,
			}),
		);
		expect(options.frequencyPenalty).toBeUndefined();
		expect(options.presencePenalty).toBeUndefined();
		expect(options.seed).toBeUndefined();
		const settings = warnings.map((w) =>
			w.type === "unsupported-setting" ? w.setting : w.type,
		);
		expect(settings).toContain("frequencyPenalty");
		expect(settings).toContain("presencePenalty");
		expect(settings).toContain("seed");
	});

	it("drops topP when temperature and topP are mutually exclusive (Anthropic)", () => {
		const { options, warnings } = applyNeonCapabilities(
			"databricks-claude-haiku-4-5",
			callOptions({ temperature: 0.5, topP: 0.9 }),
		);
		expect(options.temperature).toBe(0.5);
		expect(options.topP).toBeUndefined();
		expect(
			warnings.some(
				(w) => w.type === "unsupported-setting" && w.setting === "topP",
			),
		).toBe(true);
	});

	it("drops reasoningEffort from provider options for Gemini", () => {
		const { options, warnings } = applyNeonCapabilities(
			"databricks-gemini-2-5-flash",
			callOptions({
				providerOptions: { openai: { reasoningEffort: "high" } },
			}),
		);
		expect(
			options.providerOptions?.openai?.reasoningEffort,
		).toBeUndefined();
		expect(warnings.some((w) => w.type === "other")).toBe(true);
	});

	it("passes through unknown models unchanged with no warnings", () => {
		const input = callOptions({ temperature: 0.2, seed: 1, topP: 0.8 });
		const { options, warnings } = applyNeonCapabilities(
			"databricks-qwen35-122b-a10b",
			input,
		);
		expect(warnings).toHaveLength(0);
		expect(options).toBe(input);
	});
});

describe("transformNeonRequestBody", () => {
	it("strips the $schema marker from tools and response_format", () => {
		const body = transformNeonRequestBody({
			model: "databricks-gemini-2-5-flash",
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						parameters: {
							$schema: "https://json-schema.org",
							type: "object",
						},
					},
				},
			],
			response_format: {
				type: "json_schema",
				json_schema: { schema: { $schema: "https://json-schema.org" } },
			},
		});
		expect(JSON.stringify(body)).not.toContain("$schema");
		// Non-schema fields are preserved.
		expect(JSON.stringify(body)).toContain("get_weather");
	});

	it("leaves a body without tools or response_format unchanged", () => {
		const body = transformNeonRequestBody({ model: "x", temperature: 0.5 });
		expect(body).toEqual({ model: "x", temperature: 0.5 });
	});
});

describe("stripJsonSchemaMarker", () => {
	it("removes $schema recursively from nested objects and arrays", () => {
		const result = stripJsonSchemaMarker({
			$schema: "x",
			nested: [{ $schema: "y", keep: 1 }],
		});
		expect(result).toEqual({ nested: [{ keep: 1 }] });
	});
});
