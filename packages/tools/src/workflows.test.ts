import { describe, expect, test } from "vitest";
import * as z from "zod";
import {
	createNeonTool,
	createNeonTools,
	type NeonToolsClientOptions,
} from "./index.js";

const SECRET = "never-expose-this-password";

const jsonResponse = (body: unknown, status = 201) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const branchCreateBody = {
	branch: { id: "br-id", name: "feature-x" },
	endpoints: [{ id: "ep-id", type: "read_write" }],
	connection_uris: [
		{
			connection_uri: `postgresql://user:${SECRET}@ep-host/neondb`,
			connection_parameters: { password: SECRET },
		},
	],
};

const projectCreateBody = {
	project: { id: "project-id", name: "tool-created" },
	connection_uris: [
		{
			connection_uri: `postgresql://user:${SECRET}@ep-host/neondb`,
			connection_parameters: { password: SECRET },
		},
	],
};

const createBranchTools = (options: NeonToolsClientOptions = {}) => {
	const requests: Request[] = [];
	const tools = createNeonTools({
		apiKey: "test-key",
		...options,
		tools: ["branches.create"] as const,
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return jsonResponse(branchCreateBody);
		},
	});
	return { requests, tools };
};

describe("branches.create", () => {
	test("creates only the selected safe tool", () => {
		const tools = createNeonTools({
			apiKey: "test-key",
			tools: ["branches.create"] as const,
		});

		expect(Object.keys(tools)).toEqual(["branches.create"]);
		expect(tools["branches.create"].id).toBe("create_branches");
		expect(tools["branches.create"].operationId).toBe("branches.create");
		expect(tools["branches.create"].requiresApproval).toBe(true);
		expect(tools["branches.create"].annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: true,
		});
	});

	test("returns branch metadata without credentials from the API response", async () => {
		const { requests, tools } = createBranchTools();

		const result = await tools["branches.create"].execute({
			project_id: "project-id",
			name: "feature-x",
			parent_id: "br-parent",
		});

		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe("POST");
		expect(requests[0].url).toBe(
			"https://console.neon.tech/api/v2/projects/project-id/branches",
		);
		expect(await requests[0].json()).toEqual({
			branch: { name: "feature-x", parent_id: "br-parent" },
		});
		expect(result).toEqual({
			data: { id: "br-id", name: "feature-x" },
		});
		expect(JSON.stringify(result)).not.toContain(SECRET);
		expect(JSON.stringify(result)).not.toContain("connection_uri");
	});

	test("forwards branch creation options without adding compute", async () => {
		const { requests, tools } = createBranchTools();

		await tools["branches.create"].execute({
			project_id: "project-id",
			protected: true,
		});

		expect(await requests[0].json()).toEqual({
			branch: { protected: true },
		});
	});

	test("forwards an abort signal", async () => {
		const controller = new AbortController();
		controller.abort();
		const { tools } = createBranchTools();

		await expect(
			tools["branches.create"].execute(
				{ project_id: "project-id" },
				{ signal: controller.signal },
			),
		).rejects.toThrow();
	});

	test("does not publish connection options on the schema", () => {
		const { tools } = createBranchTools();
		const schema = z.toJSONSchema(tools["branches.create"].inputSchema);

		expect(schema.properties).not.toHaveProperty("pooled");
		expect(schema.properties).not.toHaveProperty("compute");
	});

	test("rejects unknown input fields", () => {
		const { tools } = createBranchTools();

		expect(
			tools["branches.create"].inputSchema.safeParse({
				project_id: "project-id",
				parentId: "br-parent",
			}).success,
		).toBe(false);
	});

	test("injects project_id from a grant", async () => {
		const { requests, tools } = createBranchTools({
			inject: { projectId: "granted-project", omitFromSchema: true },
		});

		await tools["branches.create"].execute({ name: "feature-x" });

		expect(requests[0].url).toBe(
			"https://console.neon.tech/api/v2/projects/granted-project/branches",
		);
	});

	test("renames the published id", () => {
		const tools = createNeonTools({
			apiKey: "test-key",
			tools: ["branches.create"] as const,
			names: { "branches.create": "create_branch" },
		});

		expect(tools["branches.create"].id).toBe("create_branch");
	});

	test("uses an execute-time credential instead of the constructor credential", async () => {
		const { requests, tools } = createBranchTools({
			apiKey: "constructor-key",
		});

		await tools["branches.create"].execute(
			{ project_id: "project-id" },
			{ apiKey: "oauth-access-token" },
		);

		expect(requests[0].headers.get("authorization")).toBe(
			"Bearer oauth-access-token",
		);
	});

	test("does not fall back to the constructor credential when execute overrides it with an empty value", async () => {
		const { requests, tools } = createBranchTools({
			apiKey: "constructor-key",
		});

		await expect(
			tools["branches.create"].execute(
				{ project_id: "project-id" },
				{ apiKey: "" },
			),
		).rejects.toThrow("A Neon API key or OAuth access token is required");
		expect(requests).toHaveLength(0);
	});
});

describe("projects.create", () => {
	test("returns project metadata without credentials from the API response", async () => {
		const requests: Request[] = [];
		const tools = createNeonTools({
			apiKey: "test-key",
			tools: ["projects.create"] as const,
			fetch: async (input, init) => {
				requests.push(new Request(input, init));
				return jsonResponse(projectCreateBody);
			},
		});

		const result = await tools["projects.create"].execute({
			name: "tool-created",
			region_id: "aws-us-east-1",
		});

		expect(requests[0].method).toBe("POST");
		expect(requests[0].url).toBe(
			"https://console.neon.tech/api/v2/projects",
		);
		expect(await requests[0].json()).toEqual({
			project: {
				name: "tool-created",
				region_id: "aws-us-east-1",
			},
		});
		expect(result).toEqual({
			data: { id: "project-id", name: "tool-created" },
		});
		expect(JSON.stringify(result)).not.toContain(SECRET);
		expect(JSON.stringify(result)).not.toContain("connection_uri");
	});

	test("keeps connection-string retrieval as an explicit approved tool", async () => {
		const tools = createNeonTools({
			apiKey: "test-key",
			tools: ["postgres.connectionString"] as const,
			fetch: async () =>
				jsonResponse({
					uri: `postgresql://user:${SECRET}@ep-host/neondb`,
				}),
		});

		const result = await tools["postgres.connectionString"].execute({
			project_id: "project-id",
			branch_id: "br-id",
			database_name: "neondb",
			role_name: "neondb_owner",
		});

		expect(tools["postgres.connectionString"].requiresApproval).toBe(true);
		expect(result.data).toContain(SECRET);
	});
});

describe("createNeonTool", () => {
	test("creates a single ergonomic tool", async () => {
		const requests: Request[] = [];
		const tool = createNeonTool("branches.create", {
			apiKey: "test-key",
			fetch: async (input, init) => {
				requests.push(new Request(input, init));
				return jsonResponse(branchCreateBody);
			},
		});

		const result = await tool.execute({
			project_id: "project-id",
			name: "feature-x",
		});

		expect(tool.id).toBe("create_branches");
		expect(requests[0].url).toBe(
			"https://console.neon.tech/api/v2/projects/project-id/branches",
		);
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});
});
