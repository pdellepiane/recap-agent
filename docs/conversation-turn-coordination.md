# Conversation turn coordination

## Scope and decision

Serialize Lambda operations that share a persisted conversation. This closes the
read/modify/write race where two messages, split by the caller's eight-second
batching window, load the same old plan and independently restart a conversation.
It does not change extraction, prompts, payment handling, or the batching window.
It does not fix semantic continuity failures that also happen sequentially.

Use the existing PlansTable with a separate `TURN_LOCK` item. No new queue, table,
global concurrency limit, heartbeat service, or model instructions are added.

## Identity and execution

- Partition key is the same exact `channel#external_user_id` used by PLAN and
  session focus. Reject `#` in channel so different identities cannot collide.
  Do not strip, lowercase, or guess user identifiers or phone numbers.
- Message IDs, session IDs, phone numbers, and event IDs do not split the lock.
  A fresh random owner token identifies each invocation; request IDs are not
  ownership tokens and must not let two retries share ownership.
- After authentication and validation, acquire before initializing the agent or
  reading plan/history. Both message and resume/overtake operations participate.
- Read PLAN and session focus consistently after acquisition. Finish model work,
  side effects, plan persistence, and response construction before release.
- Another conversation can execute independently. Within one conversation this
  guarantees mutual exclusion, not strict FIFO ordering among three or more
  waiters or delivery ordering by the external sender.

## Lease and failures

Acquire via conditional Put: absent, expired, or same owner for an SDK retry.
Release via conditional Delete matching the owner; an older invocation cannot
delete another invocation's lock. A conditional conflict means contention;
other storage errors fail closed before agent work.

The lease lasts until the invocation's actual Lambda hard deadline plus a
five-second safety margin. This intentionally replaces the earlier proposed
30-second heartbeat lease: a suspended process could otherwise lose its lease
and resume writing while a new owner is working. No early takeover is allowed.
The fixed deadline assumes Lambda enforces termination and clocks remain within
the safety margin; it is not a general-purpose lock for unbounded processes.

Normal completion releases immediately. A killed invocation can leave its lock
until that deadline (currently up to the configured 90 seconds plus margin).
DynamoDB TTL is not involved. Release failure is logged, but does not transform
a successfully processed turn into a retryable failure and repeat its effects.

Wait at most 45 seconds with approximately 200–400 ms jittered polls, and stop
earlier when fewer than 30 seconds remain for execution. This reserve does not
guarantee an arbitrary model/backend request will complete. At exhaustion return
HTTP 503 `conversation_busy`, `retryable: true`, `Retry-After: 2`; on acquisition
failure return HTTP 503 `coordination_unavailable`. Neither response is an
assistant message or a successful acknowledgement.

## Explicit limitations and release decision

The owner reports that the invocator probably does **not** retry non-200 results.
Therefore this lock-only implementation cannot guarantee a response to a message
whose wait expires, nor recover a message after Lambda crashes. Deployment
acceptance must acknowledge that limitation or add durable delivery/retry first.
The lock prevents concurrent processing; it does **not** deduplicate a repeated
message ID after the first invocation completes, cache/replay responses, or
guarantee exactly-once RSVP/escalation side effects. Do not claim otherwise.

For guaranteed delivery, separately agree on either a caller retry contract
(stable batch IDs, acknowledgement rules and idempotency) or a durable Lambda-side
inbox/worker. Those are outside this bounded change. An in-memory lock, fixed
sleep, extra batching delay, silently returning 200 on contention, or releasing
an active invocation early would not safely close that gap.

## Observability and minimum disclosure

Log only coordination outcome, wait/duration, attempt count, and the existing
sanitized request correlation. Never log owner tokens, raw partition keys, phones,
messages, or backend payloads. Success response headers expose only wait
milliseconds and acquisition attempts for evaluation. No lock fields are stored
in the event plan, extracted by a model, or added to any prompt: instruction and
input schema byte delta is zero for an otherwise identical model call.

## Validation and rollout

1. Offline tests: same-user exclusion, different-user independence, key collisions,
   different message/session IDs, consistent reads, ownership-safe release,
   expired/crashed owners, storage failures, deadline exhaustion, and no release
   while operation still runs. Test control routes as well as message routes.
2. Mandatory live regression reconstructs Claudia's card-support question and
   guest/event detail. Start the second request only after observing the first
   real lock. Require second-turn attempts >= 2, retained support route, and a
   hard semantic judge forbidding welcome restart or renaming Claudia to Roger.
   A run that fails to overlap must fail, not substitute sequential coverage.
3. Run typecheck/lint/all tests and prompt audits. Deploy through existing
   CloudFormation (only added permission: DeleteItem on PlansTable) using se-dev,
   us-east-1, verified account 684516060775. Run the complete live behavior gate.
4. Record revision, artifacts, counts, and unresolved semantic failures in the
   implementation log. Do not treat this focused lock as a fix for every earlier
   conversation failure. If rolling back, restore the prior runtime through the
   existing deployment procedure and avoid mixed old/new writers during rollout;
   old code does not honor the lock. No plan migration is needed.

## Sources

- [DynamoDB conditional expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [PutItem API semantics](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html)
- [AWS Builders Library: leader election and lease hazards](https://d1.awsstatic.com/builderslibrary/pdfs/leader-election-in-distributed-systems.pdf?did=ba_card-body&trk=ba_card-body)
