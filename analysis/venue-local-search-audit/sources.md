# Sources

| Name | Path or URL | Type | Date Checked | Why It Matters | Caveats |
| --- | --- | --- | --- | --- | --- |
| Venue term scan artifact | `analysis/venue-local-search-audit/artifacts/local-venue-search-scan-2026-04-20.json` | Generated JSON artifact from live API | 2026-04-20 | Primary evidence for term-level result consistency across `/filtered` and `/filtered/full`. | Sampled first 4 pages per term; endpoint behavior can evolve. |
| Venue term summary artifact | `analysis/venue-local-search-audit/artifacts/local-venue-search-summary-2026-04-20.json` | Generated JSON summary | 2026-04-20 | Compact view of unique-hit counts per venue synonym for quick comparison. | Derived from the scan artifact, not independent collection. |
| Lima category distribution artifact | `analysis/venue-local-search-audit/artifacts/lima-query-category-distribution-2026-04-20.json` | Generated JSON artifact | 2026-04-20 | Sanity check for category mix returned by location keyword query. | Location keyword behavior is sparse and not a full-catalog coverage measure. |
| Gateway implementation | `src/runtime/sinenvolturas-gateway.ts` | Source code | 2026-04-20 | Defines alias normalization, query strategy, and ranking behavior for category searches. | Snapshot at audit time; later refactors may diverge. |
| Gateway regression tests | `tests/sinenvolturas-gateway.test.ts` | Test code | 2026-04-20 | Confirms fallback logic for venue alias category-location search. | Mocked responses validate logic flow, not external API uptime/quality. |
