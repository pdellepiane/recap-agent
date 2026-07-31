# First-Class Multi-Capability Information Flow

## Purpose

The information engine resolves read-only user questions through one reusable
state-machine flow. It supports:

- general FAQ knowledge;
- authenticated events associated with the user;
- authenticated order summaries;
- authenticated gift-purchase details; and
- any read-only combination of those capabilities in one turn.

Provider planning, provider selection, closing, pause, and human takeover remain
exclusive action flows. Pause and takeover keep immediate precedence. When an
exclusive action and one or more information requests appear together, the
runtime preserves both goals and asks which one to handle first.

## Turn work plan

The structured extractor returns:

```ts
type TurnWorkPlan = {
  actionIntent: ActionIntent | null;
  informationRequests: InformationRequest[];
};
```

Each information request is a discriminated value:

- `faq`: complete natural-language knowledge query;
- `associated_event`: complete question plus an optional event hint;
- `purchase`: `orders` or `gift_purchases`, optional order ID, requested
  aspects, explicitly requested sensitive fields, and authentication action.

The model performs the semantic classification. Deterministic runtime code only
validates the typed result, assigns stable request IDs, preserves pending work,
and enforces state invariants. No keyword or exact-string routing is used.

General policies and product explanations become FAQ requests. Questions about
the requesting user's order, payment, shipment, dedication, gift card, or
thank-you message become authenticated purchase requests. Ambiguous ownership
must produce one clarification instead of a guessed route.

## Orchestration

All read-only work enters `resolver_consultas_informativas`. The
`InformationOrchestrator` uses a capability registry boundary with typed inputs
and results:

| Capability | Prerequisite | Source | Model projection |
| --- | --- | --- | --- |
| FAQ | Configured vector store | OpenAI vector-store search | Ranked normalized evidence |
| Associated event | Valid `user_auth` JWT | User event API | Event facts with purchase and finance data removed |
| Orders | Valid `user_auth` JWT | Agent API `/orders` | Request-scoped order fields |
| Gift purchases | Valid `user_auth` JWT | Agent API `/gift-purchases` | Request-scoped payment, dedication, shipping, decline, or thanks fields |

Independent ready tasks run concurrently with `Promise.allSettled`. The reply
model receives one ordered `InformationTaskResult[]` and composes one Spanish
response. A failed task does not discard successful results. The response
answers completed parts and gives exactly one next step for blocked work.

Only structured pending requests, compact order-selection candidates, and a
resume node are stored in `information_state`. API responses, knowledge chunks,
JWTs, OTPs, API keys, and payment-sensitive payloads are never stored there.

## Shared user authentication

`user_auth` is shared by associated-event and purchase capabilities. One
successful email OTP verification unlocks every pending authenticated request.
The production endpoints are:

- `POST https://api.sinenvolturas.com/api-web/user/request-login-code`
- `POST https://api.sinenvolturas.com/api-web/user/login-code`

Before order assistance, the Spanish response asks only for the next useful
step: the email used to register with Sin Envolturas. It explains briefly that
the verification code is required for account security. If the code does not
arrive, the response displays the exact email on record, asks the customer to
check promotions and junk mail, and offers either a resend or an email change.
The original personal question resumes automatically after verification.

JWTs remain outside prompts and traces. A `401` resets `user_auth` and preserves
the affected request for reauthentication.

## Purchase API and disclosure

The only Agent API base URL is:

```text
https://api.sinenvolturas.com/api/agent
```

Purchase reads call:

- `GET /orders`
- `GET /orders?order_id=...`
- `GET /gift-purchases`
- `GET /gift-purchases?order_id=...`

Every call sends `X-Agent-Key` and `Authorization: Bearer <JWT>`. The service key
is resolved from Secrets Manager. The JWT comes only from the authenticated
user session.

An explicit order ID is propagated unchanged. Without one, the API may return
recent purchases. If exactly one record is returned, the orchestrator uses its
order ID in the precise endpoint automatically. If multiple records could answer
the question, the assistant shows a compact selection, persists only the minimum
candidate metadata, and uses the selected order ID in the precise endpoint.

Purchase disclosure is scoped to the requested aspects. Transaction identifiers,
gateway messages, operation codes, bank data, destination accounts, and voucher
images are withheld unless the extractor records that the user explicitly asked
for the corresponding field.

Host finance, withdrawals, ownership disputes, and purchase modifications are
not read-only capabilities and offer human support. Personal gift-purchase
details are supported and must never receive a blanket refusal.

## Failure handling

A specific-order `404` with the documented Agent API error envelope means the
order was not found for the authenticated account. A generic or route-level
`404` means the production route is unavailable. Route unavailability preserves
the request, answers any successful FAQ or event portions, and offers human
support or a later retry. The runtime never falls back to a development host.

Timeouts, `429`, and server failures follow the bounded Agent API retry policy.
Malformed success payloads fail closed as `invalid_response` and are not sent to
the reply model as facts.

## Knowledge retrieval

FAQ retrieval is an explicit gateway call to
`OpenAI.vectorStores.search(...)`. It uses the complete semantic query, bounded
result count, query rewriting, ranking options, scores, and normalized evidence.
The reply agent has no hosted `file_search` tool, so standalone and mixed FAQ
questions use the same retrieval and grounding path.

## Observability and privacy

Traces record one redacted execution summary per capability:

- request ID;
- capability kind;
- source;
- completed, blocked, or failed status;
- result count; and
- latency.

Raw user questions, evidence chunks, API responses, JWTs, OTPs, service keys,
personal details, and payment details are excluded from capability trace
summaries.

Agent API message logging remains independently controlled by
`AGENT_MESSAGE_LOGGING_ENABLED` and defaults to `false`. Read-only purchase
calls do not enable or depend on message logging.

## Configuration

The runtime, CloudFormation template, and deployment script share these
settings:

```text
SINENVOLTURAS_USER_AUTH_BASE_URL=https://api.sinenvolturas.com/api-web/user
AGENT_API_BASE_URL=https://api.sinenvolturas.com/api/agent
AGENT_MESSAGE_LOGGING_ENABLED=false
KB_ENABLED=true
KB_VECTOR_STORE_ID=...
KB_MAX_RESULTS=6
KB_SCORE_THRESHOLD=0
AGENT_FEATURE_PURCHASE_INFORMATION=true
```

This project intentionally has no compatibility shim for the former
`guest_auth`, `consultar_faq`, `consultar_evento_invitado`, or hosted
`file_search` design. Development sessions created with the old state may need
to authenticate again.
