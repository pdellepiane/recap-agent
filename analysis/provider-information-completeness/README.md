# Provider Information Completeness

## Scope

- Question: is the current provider information rich enough for the agent to differentiate providers in recommendations, and what gaps should be fixed in prompts versus upstream data collection?
- Focus: compare raw search summaries, enriched provider detail records, and the current prompt/runtime expectations that consume them.

## Current Status

- Updated on 2026-04-14 with an exhaustive entry-level audit of the full live marketplace: 182 providers, 16 list pages, and 182 provider-detail fetches.
- Current answer: the agent has enough data to differentiate providers in many categories, but coverage is still uneven enough that ranking and strict comparison remain unreliable for a large minority of entries.
- Hard-data coverage is now available at the provider level through CSV and JSON artifacts, not only through aggregate percentages.
- Confidence: high for the current endpoint snapshot on 2026-04-14. These conclusions are backed by a full provider-by-provider audit rather than a sample.

## Durable Files

- [findings.md](findings.md)
- [how-to-repeat.md](how-to-repeat.md)
- [sources.md](sources.md)
- [Spanish stakeholder presentation](presentacion-stakeholders-es.md)
- [Latest dated note](dates/2026-04-14.md)
