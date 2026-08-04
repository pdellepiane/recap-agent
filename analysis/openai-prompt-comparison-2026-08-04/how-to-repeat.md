# Reproduce the comparison

Run the local byte and structure comparison without contacting OpenAI:

```sh
npm run audit:prompts:compare -- \
  --output-dir analysis/openai-prompt-comparison-2026-08-04
```

Add exact, non-generative OpenAI input-token counts:

```sh
npm run audit:prompts:compare -- \
  --remote-token-count \
  --output-dir analysis/openai-prompt-comparison-2026-08-04
```

The second command requires `OPENAI_API_KEY`. It calls only
`/responses/input_tokens`; it does not call `POST /responses`, create a Response,
or generate output.

Use a different historical checkpoint when needed:

```sh
npm run audit:prompts:compare -- --baseline-ref <git-ref>
```

Run the enforced tests:

```sh
npx vitest run tests/prompt-audit.test.ts \
  tests/static-prompt-comparison.test.ts
```
