---
"@neondatabase/env": patch
"neonctl": patch
---

Update AI Gateway env output so `OPENAI_BASE_URL` points at the branch chat-completions endpoint (`/v1/chat/completions`) while preserving the bare `NEON_AI_GATEWAY_BASE_URL` alias.
