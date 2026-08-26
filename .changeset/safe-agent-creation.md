---
"@neon/tools": minor
"neon": minor
"neonctl": minor
---

Publish `projects.create` and `branches.create` as credential-free creation tools, with connection strings retrieved explicitly through `postgres.connectionString`. The combined `projects.createAndConnect` and `branches.createWithCompute` selectors are no longer published. Add `--no-secrets` to project and branch creation in the Neon CLI.
