---
"@neondatabase/config-runtime": minor
---

Function bundles now record unix file modes and preserve nested output paths in the deploy archive (previously entries were flattened by basename and carried no permissions), and `buildFunctionBundle` accepts esbuild `plugins` — enabling plugins that emit extra files alongside the bundle, like `@neondatabase/esbuild-plugin-mise` shipping executable CLI tools under `tools/<platform>/`.
