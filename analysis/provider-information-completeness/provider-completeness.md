# Findings

## Current Understanding

- The dossier now has exhaustive provider-level coverage for the full marketplace snapshot on 2026-04-14.
  - The audit fetched all 182 providers reported by `/filtered?page=1`, all 182 provider detail records, and stored provider-by-provider outputs in `provider-entry-audit.csv` and `provider-completeness-audit.json`.
  - This means the analysis can now answer both marketplace-level questions and entry-level questions such as which exact providers are missing location, price, promo structure, or event types.
  - Evidence: `analysis/provider-information-completeness/artifacts/provider-completeness-audit.json` and `analysis/provider-information-completeness/artifacts/provider-entry-audit.csv`.

- Recommendation-time detail records are generally sufficient for textual differentiation, but coverage is uneven enough that a large low-signal segment still exists.
  - After detail enrichment, only 2 detail collision clusters remained, both in `Bebés`. They cover 5 providers total whose normalized details are still effectively indistinguishable.
  - However, 73 of 182 providers have only 1 or 2 comparison signals across location, structured price, website, structured promo, description snippet, service highlights, terms highlights, event types, and non-zero rating.
  - Conclusion: the agent can usually explain differences, but for roughly 40% of the marketplace it is still working with thin evidence.
  - Evidence: `analysis/provider-information-completeness/artifacts/provider-completeness-audit.json`.

- Raw search summaries are not sufficient for provider differentiation on their own.
  - Summary records had 0 completeness for `promoBadge`, `promoSummary`, `descriptionSnippet`, `serviceHighlights`, and `termsHighlights`, plus 0 completeness for `websiteUrl`.
  - Structured comparison fields remain weak even in the April 14 marketplace snapshot: `location` is present in only 57.7% of detail records, `structuredPrice` in 48.9%, `websiteUrl` in 56.0%, and `nonZeroRating` in only 2.2%. `eventTypes` is still 0%.
  - Category-level summary collisions remain severe: `Bebés` collapses 35 providers into only 2 summary signatures, `Vestidos` collapses 6 providers into 1, and `Hogar y deco` collapses 19 providers into 3.
  - Conclusion: recommendation prompts should assume that meaningful differentiation comes from detail enrichment, not from the initial search payload.

- The biggest quality issue is uneven structured metadata by category, not a total absence of descriptive text.
  - Across all 182 providers, `descriptionSnippet` reaches 100% completeness, `structuredPromo` 56.6%, `serviceHighlights` 58.2%, `termsHighlights` 58.2%, `location` 57.7%, `structuredPrice` 48.9%, `websiteUrl` 56.0%, `eventTypes` 0%, and `nonZeroRating` 2.2%.
  - The weakest large categories are starkly under-structured:
    - `Vestidos`: 0% completeness for location, structured price, structured promo, service highlights, and terms highlights.
    - `Bebés`: 2.9% location, 0% structured price, 2.9% structured promo, 5.7% service highlights, 2.9% terms highlights.
    - `Hogar y deco`: 10.5% location, 10.5% structured price, 0% structured promo, 5.3% service highlights, 5.3% terms highlights.
  - The strongest categories are much healthier: `Catering`, `Fotografía y video`, `Wedding planners`, `Música`, `Florería y papelería`, and `Maquillaje` all have near-complete promo plus high service-and-terms coverage.
  - 73 providers advertise promo-like offers in the title while still lacking structured promo fields, and 40 providers have generic or low-value `termsHighlights`.
  - Conclusion: the marketplace is split between high-signal categories that already support good recommendation quality and low-signal categories where the agent still relies mostly on thin marketing text.

- This data source is temporally unstable, and the analysis must keep using absolute dates.
  - The previous full census on 2026-04-10 saw 180 providers; the exhaustive audit on 2026-04-14 saw 182 providers and materially better coverage in several fields.
  - Conclusion: any product decision based on provider-data quality should cite the audit date explicitly and should not assume these rates are static.

## Implications For Prompts

- The recommendation prompt can differentiate providers if it prioritizes detail fields in this order: `promoBadge` or `promoSummary`, `serviceHighlights`, `termsHighlights`, `descriptionSnippet`, then structured price and location when present.
- The prompt should not treat `rating` as a ranking signal unless it is non-zero, because only 4 of 182 providers currently have non-zero ratings.
- The prompt should not rely on `eventTypes` as evidence until upstream fixes the feed or the gateway derives a trustworthy fallback.
- When a provider lacks concrete fields among promo, services, terms, price, and location, the prompt should explicitly frame the option as having limited structured detail instead of inventing a stronger comparison.
- For categories with residual detail collisions such as `Bebés`, the prompt should avoid overclaiming meaningful distinctions when two options expose nearly identical detail fields.
- For low-signal providers with `comparisonSignalCount <= 2`, the prompt should bias toward transparency and ask for refinement rather than pretend strong confidence.

## Upstream Collection Priorities

- Add or repair structured `eventTypes` for provider detail records.
- Normalize a reliable service area field such as city, region, or travel coverage for all providers.
- Add at least one normalized price anchor per provider or package family.
- Normalize promo metadata so title-level offers also populate `promoBadge` or `promoSummary`.
- Add a structured service or package taxonomy so the agent can compare providers on more than free-form prose.
- Consider a stronger trust signal than raw rating alone, such as review count, verified bookings, or last activity, because `rating` is currently near-useless as a comparator.
- Prioritize cleanup category-by-category instead of only field-by-field, starting with `Vestidos`, `Bebés`, `Hogar y deco`, `Salud y belleza`, and `Otros`.
