# Contributing

Thanks for helping. A few things that keep this codebase coherent:

1. **Read `AGENTS.md` first.** It is the project's conventions file (also loaded by Claude Code and Codex when they work in this repo).
2. **No client brand in the tree.** Business facts live in the `BrandProfile` captured at `/welcome`, never in prompts, defaults, placeholders or tests. `npm test` fails if a real business name creeps in.
3. **Every language-model call goes through `src/lib/llm`.** Do not import the Anthropic SDK elsewhere, never touch CLI credentials, never pass `--bare`.
4. **Before you push:** `npm run lint && npm run build && npm test`. CI runs the same three on Node 22.
5. **Keep changes narrow.** One concern per pull request, with a short description of what and why.

Licensed under AGPL-3.0 — contributions are accepted under the same licence.
