# Frozen Cases and Iteration-3 Results

Study: `technical-study-2026-07-02T06-40-49-761Z`  
Protocol: 50 Spanish scenarios × 3 isolated repetitions = 150 conversations.

`Pass` means every frozen hard assertion passed in all repetitions. `Fail`
means at least one hard assertion failed in every repetition. Zero flakiness
means classification was repeatable, not that every scenario succeeded.

## Case inventory

| ID | Route | Conversation summary | Result |
| --- | --- | --- | --- |
| wedding.01 | recommendation | Complete natural photo/video request in Miraflores | Fail |
| wedding.02 | clarification | Catering request with no location | Fail |
| wedding.03 | multi-need | Lima venue + catering + live music | Fail |
| wedding.04 | refinement | Refine photography to documentary/natural style | Fail |
| wedding.05 | selection | Select first photography option | Fail |
| wedding.06 | pause/resume | Pause and resume catering plan | Fail |
| wedding.07 | closure | Select photographer and close with contact data | Fail |
| wedding.08 | FAQ | Ask whether Sin Envolturas charges commission | Pass |
| wedding.09 | no-results | Submarine venue, 500 guests, tomorrow, low budget | Fail |
| wedding.10 | recovery | Broaden venue search to Lima Metropolitana | Fail |
| birthday.01 | recommendation | Catering in Surco for 45, medium budget | Pass |
| birthday.02 | clarification | DJ request with no location | Fail |
| birthday.03 | multi-need | Children's catering + colorful decoration | Fail |
| birthday.04 | refinement | Vegetarian, informal but polished catering | Pass |
| birthday.05 | selection | Select first catering option | Pass |
| birthday.06 | pause/resume | Pause and resume music plan | Fail |
| birthday.07 | closure | Select catering and close with contact data | Pass |
| birthday.08 | FAQ | Ask how to contact a provider | Pass |
| birthday.09 | no-results | Real astronaut band tomorrow, minimum budget | Fail |
| birthday.10 | recovery | Broaden medieval animation to Lima entertainment | Fail |
| baby_shower.01 | recommendation | Venue in Miraflores for 40, medium budget | Fail |
| baby_shower.02 | clarification | Pastel decoration with no location | Fail |
| baby_shower.03 | multi-need | Lima venue + catering + sober decoration | Fail |
| baby_shower.04 | refinement | Venue only; exclude catering and decoration | Fail |
| baby_shower.05 | selection | Select first venue | Fail |
| baby_shower.06 | pause/resume | Pause and resume decoration plan | Fail |
| baby_shower.07 | closure | Select venue and close with contact data | Fail |
| baby_shower.08 | FAQ | Ask whether gift lists are offered | Pass |
| baby_shower.09 | no-results | Private-island venue, very low budget | Fail |
| baby_shower.10 | recovery | Broaden Japanese decoration to minimalist Lima | Fail |
| corporate.01 | recommendation | Professional venue in San Isidro for 100 | Fail |
| corporate.02 | clarification | Audiovisual production with no location | Fail |
| corporate.03 | multi-need | Conference venue + catering + audiovisual | Fail |
| corporate.04 | refinement | Executive, accessible presentation venue | Fail |
| corporate.05 | selection | Select first corporate venue | Fail |
| corporate.06 | pause/resume | Pause and resume catering plan | Fail |
| corporate.07 | closure | Select venue and close with contact data | Fail |
| corporate.08 | FAQ | Ask what information providers receive | Pass |
| corporate.09 | no-results | Airport auditorium for 900 tomorrow, low budget | Fail |
| corporate.10 | recovery | Broaden holograms to professional audiovisual | Fail |
| social.01 | recommendation | Anniversary catering in Barranco for 30 | Pass |
| social.02 | clarification | Graduation music with no location | Fail |
| social.03 | multi-need | Quinceañera venue + photo + music + decoration | Fail |
| social.04 | refinement | Intimate modern gluten-free dinner | Pass |
| social.05 | selection | Select first graduation music option | Pass |
| social.06 | pause/resume | Pause and resume baptism catering | Fail |
| social.07 | closure | Select anniversary catering and close | Pass |
| social.08 | FAQ | Ask whether event websites are designed | Pass |
| social.09 | no-results | Symphony tomorrow in Lurín, very low budget | Fail |
| social.10 | recovery | Broaden robot decoration to modern decoration | Fail |

The exact Spanish turns and typed expectations are in
`evals/studies/technical-evaluation-50-v1.json`.

## Complete aggregate results

### Frozen protocol

- Hard-assertion completion: 39/150 (26.00%; Wilson 95% CI
  19.64%–33.56%); failed assertions: 111/150.
- Runtime errors/timeouts: 0; stable scenarios: 13 passed, 37 failed, 0 flaky.
- Shortlist expectation: 45/45; event type: 145/150; persistence: 150/150.
- Expected path: 95/150; terminal node: 83/150.
- First expected need: 54/135. This is contaminated by noncanonical labels.

### Recommendation quality

- Provider appearances/unique providers: 790/59; mean shortlist: 3.48.
- Location: 538 satisfied, 90 unknown, 0 mismatched (628 applicable).
- Category satisfaction: 790/790; budget compatibility: 134/134.
- Event-service evidence for `Hogar y deco`: 39/68 (57.35%).
- Final-plan needs with recommendations: 167/208 (80.29%). This denominator
  varies with extraction breadth and is not a pure retrieval metric.
- Exposure HHI: 0.0571; top-provider share: 9.87%.

### Architecture and workflow

- Conversation latency mean/median/p95/min/max:
  18.65/19.27/27.30/7.12/33.31 seconds.
- Tokens mean/median/p95: 34,232/34,416/61,607.
- Tool calls mean/median/p95: 1.93/2/5.
- Total priced cost: USD 1.06475; mean USD 0.00710/conversation.
- Node coverage: 18/26; transition coverage: 33/49; unique routes: 16.

### Grounding

- Deterministic provenance: 239/239 grounding-required turns.
- Primary review of the 20-row iteration-3 manual audit found provider
  existence 20/20, attribute faithfulness 19/20, recommendation-rationale
  support 6/10 applicable turns, and hard-constraint consistency 14/20.
- Independent second review and disagreement adjudication remain outstanding.

## Interpretation warning

The 26% rate is not a valid general user-task success estimate because some
hard expectations are defective. That does not explain everything: all five
missing-location clarification cases failed their intended route, and the
multi-need, pause/resume, no-results, and recovery families had zero strict
passes.

Authoritative files are `summary.json`, `conversations.csv`, and `runs/` under
`artifacts/technical-study-2026-07-02T06-40-49-761Z/`.
