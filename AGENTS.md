# Project Conventions

- Always write code, comments, docs, and developer-facing responses in English.
- Conversational prompt content is the only artifact that must remain in Spanish.
- Store all prompts as git-trackable text files under `prompts/`, mapped to exact flow nodes.
- Use CloudFormation for serverless deployment artifacts and infrastructure changes.
- Keep commits atomic, single-responsibility, and short in their explanation.
- Maintain `docs/implementation-log.md` for every code or prompt change, including reason and decision.
- Use TypeScript and the latest OpenAI Agents SDK line adopted by the repo.
- This TypeScript codebase uses strict type definitions. Explicit `any` is banned in source, tests, and repo scripts.
- Prefer high-quality TypeScript defaults: validate inputs, model domain types explicitly, use `unknown` instead of `any`, and keep runtime configuration typed and centralized.
- Treat the agent as event-plan-first: the primary artifact is an event plan that can contain multiple provider needs, while single-provider search remains a natural subset of that behavior.
- Keep the runtime channel-agnostic. WhatsApp-specific behavior belongs in adapters, not in core flow logic.
- Streaming responses are out of scope for now because WhatsApp does not support them. The terminal client should emulate WhatsApp behavior directly rather than introducing capabilities that the real channel cannot use.
