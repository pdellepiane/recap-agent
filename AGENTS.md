# Project Conventions

## Minimum Disclosure

- Treat prompt context as a constrained runtime resource, not a documentation dump. Before every model call, project the smallest typed state, evidence, policy, and tool surface that can produce the required decision or response.
- Do not send instructions for result types, routes, tools, fields, or failure modes that are impossible or irrelevant in the current turn. Dynamic state-machine evidence must replace broad conditional guidance whenever the runtime already knows the branch.
- Prefer route- and outcome-specific prompt sections selected deterministically from validated state. Keep shared prompts short, non-conflicting, and limited to invariants that cannot be projected.
- When adding a prompt rule, first try to encode the invariant in typed runtime state or deterministic evidence and include only the resulting guidance. Add a prompt-size/relevance regression proving irrelevant content is absent; never solve uncertainty by appending another global rule.
- Measure serialized instruction and input bytes for changed model calls. A behavior fix is incomplete if it needlessly increases prompt size or reintroduces duplicated/conflicting instructions.

- Always write code, comments, docs, and developer-facing responses in English.
- Conversational prompt content is the only artifact that must remain in Spanish.
- Store all prompts as git-trackable text files under `prompts/`, mapped to exact flow nodes.
- Use CloudFormation for serverless deployment artifacts and infrastructure changes.
- For every local AWS CLI or SDK operation, use only the `se-dev` execution profile in `us-east-1`. Refresh its backing login with `aws login --profile se-signin`; never run this repository's AWS commands through `default` or any other profile. Mutating scripts must fail closed unless STS confirms account `684516060775`.
- Keep commits atomic, single-responsibility, and short in their explanation.
- Maintain `docs/implementation-log.md` for every code or prompt change, including reason and decision.
- Use TypeScript and the latest OpenAI Agents SDK line adopted by the repo.
- This TypeScript codebase uses strict type definitions. Explicit `any` is banned in source, tests, and repo scripts.
- Prefer high-quality TypeScript defaults: validate inputs, model domain types explicitly, use `unknown` instead of `any`, and keep runtime configuration typed and centralized.
- Never use keyword or exact-string matching to decide conversational flow. Flow decisions must come from structured LLM extraction and typed state-machine evidence; deterministic code may only validate invariants or preserve already-established state.
- Treat the agent as event-plan-first: the primary artifact is an event plan that can contain multiple provider needs, while single-provider search remains a natural subset of that behavior.
- Keep the runtime channel-agnostic. WhatsApp-specific behavior belongs in adapters, not in core flow logic.
- Streaming responses are out of scope for now because WhatsApp does not support them. The terminal client should emulate WhatsApp behavior directly rather than introducing capabilities that the real channel cannot use.
- Do not build or preserve backward-compatibility shims while this project remains in active development. Prefer clean breaks and redevelop from the current design when needed.
- After any Lambda-impacting change (runtime, handler, prompts consumed by Lambda, infrastructure, or dependencies), redeploy the Lambda in development so local validation always runs against current behavior.
- Treat every concrete interaction supplied to fix agent behavior as a permanent regression specification. Analyze the complete interaction and relevant stored plan, extraction, tool, provider, and trace evidence; state the correct expected behavior; and add a git-tracked live Lambda evaluation case that reconstructs that context instead of testing an isolated phrase.
- Put every interaction-derived live case in `live_behavior_regression`. Give it hard structural assertions plus a hard `text_semantic` expectation with `requireJudge: true` that describes the correct response behavior. Add a deterministic offline twin when the behavior can also be verified without a model.
- Register every new feature or fix that can change conversational behavior as a separate entry in `evals/live-behavior-coverage.yaml`, even when it reuses an existing live case. Never treat an older registry entry as coverage for a later behavior change. Before handoff, run `tests/live-behavior-coverage.test.ts` to prove that every registered change points to a mandatory live Lambda case with both hard structural assertions and a hard semantic judge.
- Any change that can alter conversational behavior—including prompts, model configuration, schemas, extraction, routing, state transitions, tools, rendering, vocabulary normalization, or output policy—must run `npm run eval:behavior-live` after the current development Lambda is deployed. A missing judge key, skipped case, evaluator error, or failed hard expectation is a failed gate. Record the case and run artifact in `docs/implementation-log.md`.
