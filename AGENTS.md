# Project Conventions

- Always write code, comments, docs, and developer-facing responses in English.
- Conversational prompt content is the only artifact that must remain in Spanish.
- Store all prompts as git-trackable text files under `prompts/`, mapped to exact flow nodes.
- Use CloudFormation for serverless deployment artifacts and infrastructure changes.
- Keep commits atomic, single-responsibility, and short in their explanation.
- Maintain `docs/implementation-log.md` for every code or prompt change, including reason and decision.
- Use TypeScript and the latest OpenAI Agents SDK line adopted by the repo.
- Keep the runtime channel-agnostic. WhatsApp-specific behavior belongs in adapters, not in core flow logic.

