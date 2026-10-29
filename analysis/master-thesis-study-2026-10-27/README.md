# Current-system master technical study — 2026-10-27

Status: preparing; no paid study call has been made. This is a new population,
separate from July V4 and all prior selected validations.

## Research question and design

How reliably and efficiently does one identified current development artifact
meet predefined, externally observable provider, FAQ/customer-service and
multi-turn safety obligations? This is a designed, regression-informed technical
benchmark, not a customer sample or an optimization experiment.

The single master protocol is `evals/studies/current-master-2026-10-27.json`:
30 distinct scenarios, three planned fresh-identity repetitions each, 90
conversations. The three strata each contain ten scenarios:

- Provider: eight live public catalog/search/detail scenarios plus controlled
  no-results and decimal-budget worlds. Public reads use the existing hybrid/
  vector configuration. No catalog-wide mocking is needed. Seeded selection and
  detail tasks are labeled separately from retrieval tasks.
- FAQ/customer service: eight new public FAQ cases use live OpenAI KB retrieval
  with independently declared published value/link checks; two complete synthetic
  purchase conversations test customer-specific facts and review outcomes.
- Continuity/authentication/effects: ten declared interactions test refusal,
  OTP, failed handoff, multi-event RSVP targeting, durable mutation/replay,
  new questions after takeover, parked requests, quote completion, public-search
  follow-up and financial-request isolation.

All Sin Envolturas mutations are mocked, including provider quotes/favorites/
reviews/view tracking, authentication effects, handoff and RSVP. Private customer
reads are mocked. Only explicitly enabled public provider reads may reach the
live Sin Envolturas API. OpenAI model/Decisions/KB/vector requests remain live
and consume the authorized study budget. Synthetic plans/effect receipts may be
written in isolated development storage. No production deployment is authorized.

## Protocol freeze and execution

Complete the provider fixes and their offline regressions before freezing.
Freeze source/fixture/prompt/evaluator/lockfile/KB hashes, resolved cases, exact
schedule, deployment code/configuration and price assumptions before the first
paid call. No tuning between repetitions. Three repeats are planned replicates,
not retries triggered by failed answers. Preserve every failure and interrupted
attempt; no semantic retry or panel expansion.

The master extension of `eval:behavior-live` requires all 30 explicit base
`--case` selectors and the frozen `--master-study` file. It expands those cases
into 90 uniquely identified executions in one run with one before/after artifact
identity check. Order is reproducibly shuffled within each repetition using seed
2701026; case concurrency is one. No judges, style checks or mandatory read-tool
or internal-node pins are added. Existing fact/effect assertions remain intact.

The exact resolved turn/assertion totals will be recorded by the freeze command,
not inferred from earlier manifests. The freeze command is:

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1 node --import tsx \
  src/evals/master-study-cli.ts freeze \
  analysis/master-thesis-study-2026-10-27/frozen-master.json
```

Only use that command after final development deployment. All AWS operations use
se-dev/us-east-1 and fail closed outside account 684516060775. Ordinary build,
fixture/case loading and offline tests do not make model calls.

## Outcomes and denominators

Primary: all tested hard observable obligations met / all 90 scheduled
conversations. Separately report assertion failures, runtime errors, timeouts,
unexecuted cases and invalid identity measurements. A convincing response alone
cannot establish an action: target, polarity and fixture receipts provide truth.

Secondary: per-scenario 0–3 passes, all-three-pass /30, stratum counts /30 attempts,
failed assertion families, grounded requested value/link checks, recommendation
need representation and candidate availability, latency by turn/conversation,
model calls, tokens/cache, instruction/input bytes, tool calls and estimated cost.
Candidate records and actual delivered provider references are separate units.
Live-provider tasks and controlled provider tasks must also be shown separately.

FAQ text checks measure requested published value/link presence, not unrestricted
entailment. They cannot detect every unsupported statement, incorrect attribution
or negation. Provider source-link format is not proof of valid entity identity;
any derivative source comparison must retain its own assessed/unknown coverage.
Correct plan state is not silently counted as correct prose. Zero checked claims
is not complete grounding.

Use a fixed-seed 10,000-resample stratified scenario-cluster bootstrap, retaining
all repetitions of a sampled scenario. Do not treat turns, provider appearances
or 90 repeated conversations as independent scenarios. Exact finite-corpus
results are primary; intervals describe scenario sensitivity, not a random
population of customers. Suppress a complete-study interval if execution is
incomplete. Live catalog/index drift is a threat to repeatability: retain
contemporaneous source evidence and prefreeze metadata, rather than pretending
that the external catalog was frozen.

## Cost and authorization

The user authorized a USD5 budget and subsequently accepted approximate costing
when the actual-cost API returned HTTP403. Final cost figures from the harness
are estimates based on measured token usage and dated endpoint-aware prices,
including reported cached usage and modeled Lambda duration. Stop admission at
USD4 estimated spend, leaving USD1 headroom for in-flight work and accounting
uncertainty. Unpriced models/stages stop further master admission. Never label
these values an invoice or an API-reported monetary charge.

The signed-in Arc dashboard exposes the matching `dev env` key. A baseline
actual-cost CSV was exported with that key filter; the secret was matched locally
without disclosure. Its 2026-09-27 through 2026-10-27 total is
USD4.257938580; October subtotal USD2.234885365; last-seven-day subtotal
USD0.781168225 (matching the rounded USD0.78 dashboard). These pre-existing
charges are not study spend. Dashboard/export reconciliation is supplementary,
can lag, and may include concurrent activity using the same key. No programmatic
billing access or exact study attribution is claimed.

## Preflight and evidence retention

Provider audit found decimal-budget punctuation and post-enrichment category
invariant defects. The live read-only category probe also exposed JSON-encoded
`event_types`. A fixture-wiring audit found real provider methods still reachable
under fixture mode; explicit read-mode isolation is required before deployment.
Each runtime fix receives its own registry entry and offline negative control.
No prompt rule is appended for these typed data/wiring defects.

Retain initial offline failures and their causes. The initial high-parallelism
run had 24 failures, predominantly timeouts; a bounded two-worker run reduced this
to two stale catalog-count assertions. One earlier policy test also scanned all
request timestamps/IDs for digits `72`; it now checks the actual policy evidence.
The dated 60-case support snapshot is preserved as a subset while current
manifest tests verify every resolved case identity. These are oracle/inventory
repairs, not regrading of live or July results. Final preflight records supersede
none of the earlier logs.

Pending prompt-review entries are not approved by generating hashes. Record the
prompt-freshness audit as-is and distinguish a research artifact from a production
release claim. Retain the final ZIP SHA-256, Lambda CodeSha256/config digest,
all manifests/snapshots/JSONL/reports, public-read captures, case/fixture hashes,
cost assumptions, all hard failures, and the scenario-level derivative tables.

The strongest supported thesis conclusion is bounded technical performance of
this identified artifact on this declared corpus. The study cannot establish
satisfaction, naturalness, business impact, complete factual faithfulness or
causal improvement over July. Human evaluation remains future work.
