# Vendor Endpoint Tool Readiness

## Scope

- Question: based on the latest vendor swagger, which API-backed tools can we implement with consistent results, and what input constraints must be enforced in runtime contracts?

## Current Status

- Updated on 2026-04-20 using `/Users/leonardocandio/Downloads/se-vendor-swagger.yaml` plus live validation of quote-date behavior.
- Current answer: two stable tool candidates are clearly defined by the swagger: one read/search tool (`GET /api-web/vendor/filtered/full`) and one write/quote tool (`POST /api-web/vendor/quote`).
- Critical implementation constraint: quote `eventDate` must be today or a future date; if user did not provide a date, the tool layer should hardcode current date to avoid unnecessary clarification turns.
- Coverage check completed on 2026-04-20: `filtered/full` significantly improves descriptive and promo richness, but city/state/country location coverage is currently poor in live payloads.
- Confidence: high for contract shape (swagger), medium-high for runtime behavior (validated on date rule only).

## Durable Files

- [findings.md](findings.md)
- [how-to-repeat.md](how-to-repeat.md)
- [sources.md](sources.md)
- [Latest dated note](dates/2026-04-20.md)
