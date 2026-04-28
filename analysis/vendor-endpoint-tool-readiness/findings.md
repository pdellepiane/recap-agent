# Findings

## Current Understanding

- Swagger-backed tool surface is currently explicit and narrow: two implementable vendor tools.
  - `GET /api-web/vendor/filtered/full` (`operationId: getFilteredVendorsFull`) is suitable for a deterministic read/search tool with typed filters and pagination.
  - `POST /api-web/vendor/quote` (`operationId: createVendorQuote`) is suitable for a deterministic quote-creation tool with strict validation constraints.

- The search endpoint has strong filter contracts that should be reflected as strict tool enums/patterns.
  - `eventTypes` enum is constrained to `all | wedding | babyshower | charity | others`.
  - `location` requires pattern `city-{id}` or `country-{id}` or `all`.
  - `budget` is enum-constrained to `$ | $$ | $$$ | $$$$`.
  - `guestsRange` must match `min-max` or `min+`.
  - `userId` must be included when `onlyFavorites=true`.

- Quote creation has a hard date rule that should be handled in the tool layer.
  - `eventDate` must be `today_or_future` per schema and 400 error payload.
  - Live validation on 2026-04-20 confirmed:
    - `eventDate=2026-04-19` returns a date validation error.
    - `eventDate=2026-04-20` removes the date error (while other invalid fields still fail as expected).
  - Practical policy: hardcode `eventDate` to current date when user omitted date, to reduce conversation turns and avoid deterministic validation failures.

- Tool implementation recommendation for consistency:
  - Implement `search_providers_full` against `/api-web/vendor/filtered/full` and keep strict request schema aligned with swagger constraints.
  - Implement `create_quote_request` against `/api-web/vendor/quote` and enforce tool-side defaulting for `eventDate` to current day when absent.
  - Avoid ambiguous legacy assumptions about `/api-web/vendor/filtered` where the latest swagger now documents `/filtered/full` explicitly.

## Coverage Check: `filtered/full` vs legacy `filtered`

- Yes, `GET /api-web/vendor/filtered/full` exposes materially richer detail fields in live payloads, but coverage gains are uneven.
  - `info.description`: 100% in `filtered/full` vs 0% in legacy.
  - `promos` presence: 60.2% in `filtered/full` vs 0% in legacy.
  - `promo badge`/`subtitle`: ~59% in `filtered/full` vs 0% in legacy.

- Some fields are effectively unchanged:
  - `event_types`: 62.4% in both endpoints.
  - `price.level`: 52.5% in both endpoints.
  - `price.min` / `price.max`: 8.8% / 0.6% in both endpoints.

- Location quality is currently worse (or differently populated) in `filtered/full` for city/state/country usage.
  - `filtered/full` location object has `city/state/country` at 0% in this run.
  - Legacy `filtered` had any location signal at 61.3% (city/country combination).
  - `filtered/full` still has `location.address` at 28.7%, so location is not entirely absent, but it is less structured for geolocation filtering.

- Practical conclusion for tool design:
  - Prefer `filtered/full` for recommendation detail richness (description/promos/flags).
  - Keep location logic defensive and not city-hardcoded from `filtered/full` alone until upstream location fields are populated.
  - For quote tool, keep hardcoded current-day fallback for `eventDate` when user omits date (validated live).
