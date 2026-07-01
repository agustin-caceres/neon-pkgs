---
"@neon/sdk": minor
---

Regenerate the client from the latest published Neon OpenAPI spec. This adds the branch recovery operation `recoverProjectBranch` (`POST /projects/{project_id}/branches/{branch_id}/recover`), the `include_deleted` query on `listProjectBranches`, the `hard_delete` query on `deleteProjectBranch`, and the `recovery` field (`BranchRecoveryInfo`) on `Branch`. The regeneration also surfaces other new raw operations from the spec (branch buckets, functions, credentials, ai-gateway/storage) in the tree-shakeable raw layer; these stay raw-only and are not wrapped in the ergonomic namespaces.
