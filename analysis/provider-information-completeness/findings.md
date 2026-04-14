# Findings

## Current Understanding

- Recommendation-time detail records are generally sufficient for textual differentiation across the full marketplace, but not for robust structured comparison.
  - On 2026-04-10, a full live census fetched all 180 providers reported by `/filtered?page=1` and all 180 provider detail records.
  - After detail enrichment, 15 of 16 categories had fully unique differentiator signatures for every provider in that category. The only exception was `Bebés`, where 35 providers collapsed to 32 detail signatures, so some enriched records still remain indistinguishable there.
  - Conclusion: for most categories the agent has enough detail to explain why option A differs from option B, but some categories still suffer from real data collisions even after enrichment.
  - Evidence: `analysis/provider-information-completeness/artifacts/provider-completeness-census.json`, `src/runtime/sinenvolturas-gateway.ts`, `src/runtime/agent-service.ts`, and `src/runtime/openai-agent-runtime.ts`.

- Raw search summaries are not sufficient for provider differentiation on their own.
  - Summary records had 0 completeness for `promoBadge`, `promoSummary`, `descriptionSnippet`, `serviceHighlights`, and `termsHighlights`, plus 0 completeness for `websiteUrl`.
  - Structured comparison fields were also thin in the full census summaries: `location` was present in only 32.8% of records, `priceLevel` in 18.9%, `minPrice` in 8.3%, and `maxPrice` in 0.6%.
  - Category-level summary collisions were severe across large parts of the marketplace: `Bebés` collapsed 35 providers into only 2 summary signatures, `Hogar y deco` collapsed 19 providers into 3, and `Vestidos` collapsed 6 providers into 1.
  - Conclusion: recommendation prompts should assume that meaningful differentiation comes from detail enrichment, not from the initial search payload.

- The biggest quality issue is inconsistency in structured metadata, not a total absence of descriptive text.
  - 176 of 180 providers had rating `0.0`, so rating is almost never a useful comparator despite being technically present on every record.
  - 146 of 180 providers had no structured price anchor (`priceLevel`, `minPrice`, and `maxPrice` all missing), 121 of 180 had no location, and all 180 had empty `eventTypes`.
  - 97 providers advertised a discount, freebie, or bonus in the title while both `promoBadge` and `promoSummary` were null, so promo information is often implicit instead of structured.
  - Detail parsing helps but is still incomplete: `descriptionSnippet` reached 100% completeness, while `promoBadge`, `promoSummary`, `serviceHighlights`, and `termsHighlights` were each present in only 40.6% to 44.4% of records.
  - Extracted `serviceHighlights` and `termsHighlights` can also contain parsing noise or generic placeholders such as `Preguntar por paquetes` or `Consultar términos y condiciones`.
  - Conclusion: the agent can often explain differences, but many differences come from semi-structured marketing text instead of reliable comparable fields.

## Implications For Prompts

- The recommendation prompt can differentiate providers if it prioritizes detail fields in this order: `promoBadge` or `promoSummary`, `serviceHighlights`, `termsHighlights`, `descriptionSnippet`, then structured price and location when present.
- The prompt should not treat `rating` as a strong ranking signal unless it is non-zero, because 176 of 180 providers in the census had `0.0`.
- The prompt should not rely on `eventTypes` as evidence until upstream fixes the feed or the gateway derives a trustworthy fallback.
- When a provider lacks concrete fields among promo, services, terms, price, and location, the prompt should explicitly frame the option as having limited structured detail instead of inventing a stronger comparison.
- For categories with residual detail collisions such as `Bebés`, the prompt should avoid overclaiming meaningful distinctions when two options expose nearly identical detail fields.

## Upstream Collection Priorities

- Add or repair structured `eventTypes` for provider detail records.
- Normalize a reliable service area field such as city, region, or travel coverage for all providers.
- Add at least one normalized price anchor per provider or package family.
- Normalize promo metadata so title-level offers also populate `promoBadge` or `promoSummary`.
- Add a structured service or package taxonomy so the agent can compare providers on more than free-form prose.
- Consider a stronger trust signal than raw rating alone, such as review count, verified bookings, or last activity, because `rating` is currently near-useless as a comparator.
