# Venue Local Search Audit

## Scope

Audit inconsistent provider search behavior for venue-like requests (`local`, `venue`, `place`, `lugar`) and define runtime/tool changes that make venue searches consistently return the marketplace `Locales` category.

## Current Status

- Scaffolded on 2026-04-20.
- Live endpoint evidence confirms the root mismatch: only `local` returns venue providers reliably, while most semantic variants (`venue`, `place`, `lugar`, `salon`, `espacio para eventos`) return zero hits.
- Gateway was updated to normalize venue-like category inputs to a stronger alias set (`local`, `locales`, related terms) and to retry category searches without location when strict `category + location` phrasing returns empty.
- Confidence: high for the identified cause and applied fix, based on live endpoint scans plus targeted gateway regression tests.

## Durable Files

- [findings.md](findings.md)
- [how-to-repeat.md](how-to-repeat.md)
- [sources.md](sources.md)
- [Latest dated note](dates/2026-04-20.md)
