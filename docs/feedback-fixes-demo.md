# Evidence-driven feedback fixes demonstration

## What this demonstration covers

This is the primary stakeholder demonstration for the 2026-07-24 live WhatsApp
audit. It connects observed evidence to the product decision, deployed fix,
observable proof, and remaining limitation.

| Category | Trace evidence | Why it mattered | Deployed proof | Status |
| --- | --- | --- | --- | --- |
| Gifts, sales, and payments | 24 of 35 retained question turns concerned transactions; the runtime had no transactional tool | Reference search was being presented as operational truth | Response states the event-information-only boundary and offers a person from the team | Deployed |
| Duplicate delivery | 10 native message-id groups were processed twice, creating 28.6% excess question records | The same inbound message could receive contradictory answers | Hashed message correlation is now explicit in `feedback_signals` | Detection improved; runtime idempotency remains pending |
| Split and ambiguous messages | “El horario” was interpreted as business hours after a fragmented exchange, and later regressed when confidence landed just above a numeric cutoff | Older/nontechnical users should not need to phrase a complete agent instruction | Explicit typed ambiguity evidence is preserved as one validated clarification question | Deployed; burst aggregation remains pending |
| Verification guidance | Code requests did not fully explain purpose, location, or image limitations | The user could not know what to do next or why | Response explains ownership verification, inbox locations, typed-code requirement, and inability to read images | Deployed |
| Email whitespace | An address such as `nombre @ejemplo.com` is unambiguous, while missing or extra characters are not | Rejecting obvious spacing creates avoidable failure; guessing characters can target the wrong account | Only whitespace adjacent to `@` is removed and the normalized plan field is shown in diagnostics | Deployed |
| Spanish-only wording | User-visible service terminology leaked in English | The intended audience may not understand internal or industry terminology | Known policy terms are normalized, and remaining known terms are recorded as feedback warnings | Deployed with review signal |
| Actual image presence | Text saying “I sent a screenshot” could not prove a media attachment existed | The assistant could confuse a capability question with an actual image turn | Native WhatsApp media metadata produces a deterministic limitation with no model or tool calls | Runtime deployed; external webhook mapping pending |
| Trace completeness | Existing quality flags were empty for all 35 reviewed turns | The trace could not explain claim risk, ambiguity, language leakage, output complexity, or duplicate groups directly | Versioned safe `feedback_signals` are stored per turn and summarized in CloudWatch | Deployed |

## Run the complete demonstration

From the repository root:

```bash
AWS_PROFILE=se-dev npm run demo:feedback-fixes
```

Requirements:

- Node.js 24 or later;
- `CHANNEL_API_KEY` in the ignored local `.env` file or process environment;
- network access to the deployed development Function URL;
- optionally `AGENT_FUNCTION_URL` for another deployment.

The script never prints the bearer credential. It uses synthetic phone numbers,
session ids, media ids, and an `example.com` email address. Each deployed case
prints its trace id and hashed message/session correlation so the presenter can
verify the corresponding DynamoDB record and CloudWatch completion event
without showing a native identifier.

## Demonstration sequence

### 1. Unsupported transaction boundary

Input:

> Tengo un problema con un regalo y necesito saber qué pasó con el pago

Explain that the audit found transaction questions dominating the retained
question traffic, while no tool could verify those operations. The response
must say direct assistance is limited to event information, offer a person from
the team, and avoid diagnosing the payment or gift.

Show:

- `routing.faq_turn`;
- `routing.intent_confidence`;
- whether file search ran;
- Spanish-policy term hits;
- output question and link counts.

### 2. Ambiguous short fragment

Input:

> El horario

Explain that a live trace previously selected business hours without enough
evidence. The response should now contain one clarification question. The
demonstration asserts `routing.ambiguity_status = ambiguous` and
`output.question_count = 1`, and requires the response to contrast the
structured interpretations with “o”; numeric confidence alone is not used as
the decision boundary.

### 3. Verification and conservative email normalization

Input shape:

> Quiero consultar la información de un evento. Mi correo es demo… @example.com

Show the normalized `plan.contact_email`. Only the whitespace surrounding `@`
is removed. Then show that the response explains:

- why the code verifies access;
- where to look for it;
- that the code must be typed into the conversation;
- that photographs and screenshots cannot be read.

No real person's email or code should be used.

### 4. Trusted image metadata

The request contains `media` and omits `text`. Show:

- `input.shape = media_only`;
- `routing.decision_source = deterministic`;
- `execution.model_call_count = 0`;
- `execution.tools_called_count = 0`;
- the direct Spanish limitation.

This proves that actual media presence comes from the channel request rather
than language inference.

### 5. Remaining burst and duplicate work

Do not present burst aggregation or runtime idempotency as complete. The
demonstration reports them as pending:

- individual messages will be retained temporarily in the adapter burst store;
- native ids will be deduplicated before runtime execution;
- ordered fragments will be sealed into one logical turn;
- retained messages exist to replay failures and improve wording from evidence.

## Per-turn feedback signals

Every new performance record contains `feedback_signals.schema_version = 1`.

| Group | Saved signals | Feedback use |
| --- | --- | --- |
| Correlation | Hashed message id and optional hashed session id | Group retries and join future raw-log exports without storing identifiers again |
| Input | Text/media shape, counts, media classes, receive time, ingress delay, and trusted-context presence | Separate text, image, delayed, and context-poor turns |
| Routing | Previous/next node, intent, confidence, explicit ambiguity status, clarification presence, route kind, FAQ state, and deterministic/model source | Find misroutes, ambiguity failures, and unexpected model use |
| Execution | Model stages, tools, file search, and latency | Explain cost, slowness, retrieval dependence, and deterministic shortcuts |
| Output | Characters, words, questions, links, list items, quality flags, and known Spanish-policy term hits | Find overly long, complicated, repetitive, or terminology-heavy responses |
| Storage boundaries | Explicit false values for raw message, raw media, and raw provider media id storage | Prevent the analytical snapshot from becoming a second raw-log store |

Known English-term detection is an analytical warning, not a conversational
router or automatic blocker. Brand names can require manual review.

## Joining raw message logs later

When the separate raw message export becomes available, request at least:

- native message id;
- channel;
- receive timestamp;
- direction;
- raw body or approved redacted body;
- media class when present;
- delivery/retry attempt when available.

Join raw rows to performance records with the SHA-256 hash of the native message
id. Use `trace_id`, captured time, channel, and session hash as secondary audit
evidence. Do not commit the raw export to the repository. Store only sanitized,
dated findings under `analysis/`.

The first enrichment pass should label:

- transaction or event-information topic;
- whether a human handoff was offered;
- whether the answer asserted an unsupported cause or procedure;
- ambiguity and whether one clarification was asked;
- duplicate attempt number;
- multi-message burst membership;
- user correction or repeated request;
- response comprehension risk;
- language-policy leakage.

These labels should become an offline feedback dataset first. They should not
change conversational flow through keyword matching.
