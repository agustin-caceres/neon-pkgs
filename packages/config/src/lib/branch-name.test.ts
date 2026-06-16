import { describe, expect, test } from "vitest";
import { slugify, toNeonBranchName } from "./branch-name.js";

describe("toNeonBranchName", () => {
	test("lowercases and slugifies a simple name", () => {
		expect(toNeonBranchName("Feature")).toBe("feature");
	});

	test("preserves slashes as segment separators by default", () => {
		expect(toNeonBranchName("feature/billing-ui")).toBe(
			"feature/billing-ui",
		);
	});

	test("sanitizes each segment and collapses separator runs", () => {
		expect(toNeonBranchName("feature/PROJ-123 Add  Billing!!")).toBe(
			"feature/proj-123-add-billing",
		);
	});

	test("trims leading/trailing separators per segment", () => {
		expect(toNeonBranchName("--feature--/__billing__")).toBe(
			"feature/billing",
		);
	});

	test("drops empty segments from repeated slashes", () => {
		expect(toNeonBranchName("feature///billing")).toBe("feature/billing");
	});

	test("applies a prefix", () => {
		expect(toNeonBranchName("feature/x", { prefix: "preview/" })).toBe(
			"preview/feature/x",
		);
	});

	test("flattens slashes when preserveSlashes is false", () => {
		expect(
			toNeonBranchName("feature/billing", { preserveSlashes: false }),
		).toBe("feature-billing");
	});

	test("keeps original case when lowercase is false", () => {
		expect(toNeonBranchName("Feature/Billing", { lowercase: false })).toBe(
			"Feature/Billing",
		);
	});

	test("falls back to 'branch' for an empty/punctuation-only input", () => {
		expect(toNeonBranchName("")).toBe("branch");
		expect(toNeonBranchName("///")).toBe("branch");
		expect(toNeonBranchName("!!!")).toBe("branch");
	});

	test("clamps to maxLength and strips a dangling separator", () => {
		const result = toNeonBranchName(`${"a".repeat(20)}-bbbbb`, {
			maxLength: 20,
		});
		expect(result.length).toBeLessThanOrEqual(20);
		expect(result.endsWith("-")).toBe(false);
		expect(result.endsWith("/")).toBe(false);
	});

	test("never returns an empty string even after clamping", () => {
		expect(toNeonBranchName("----------", { maxLength: 1 })).toBe("branch");
	});

	test("is idempotent on an already-valid name", () => {
		const once = toNeonBranchName("preview/feature/billing-ui");
		expect(toNeonBranchName(once)).toBe(once);
	});
});

describe("slugify", () => {
	test("produces a flat token with no slashes", () => {
		expect(slugify("feature/Billing UI")).toBe("feature-billing-ui");
	});

	test("honors prefix and lowercase options", () => {
		expect(slugify("Billing", { prefix: "fn-" })).toBe("fn-billing");
	});
});
