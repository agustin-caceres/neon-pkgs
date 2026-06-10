---
"@neondatabase/esbuild-plugin-mise": minor
---

New package: esbuild plugin that ships mise-style CLI tools (ripgrep, jq, gh, …) inside the bundle for sandboxed runtimes, plus a tree-shakeable `/runtime` helper that stages the binaries into a writable directory and prepends them to `PATH`. Tools are declared in plugin options or `mise.toml`, resolved and pinned at build time, and downloaded per target platform — nothing is ever installed on the user's system.
