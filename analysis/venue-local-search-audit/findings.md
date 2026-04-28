# Findings

## Current Understanding

- Live endpoint behavior is asymmetric for venue terms:
  - `search=local` returns venue providers (`Locales`) in both `/filtered` and `/filtered/full`.
  - Equivalent user-intent terms (`venue`, `place`, `lugar`, `salon`, `espacio para eventos`, `local para eventos`) returned zero providers in the sampled scan.
- `/filtered/full` still carries weaker category completeness for these records (category frequently null), so venue categorization should continue to rely on merged legacy `/filtered` metadata when available.
- Root cause in runtime behavior: venue-like categories were not normalized broadly enough before query composition, and strict `category + location` phrases could eliminate otherwise valid venue candidates.
- Implemented gateway fix:
  - Expanded venue alias normalization in `categoryAliases()` to include `local`, `locales`, `venue`, `place`, `lugar`, `salon`, `espacio`, and `recepcion` families.
  - Updated `searchProvidersByCategoryLocation()` to attempt multiple alias-based search terms and fallback from `category + location` to `category-only` when needed.
  - Added regression test covering `venue` fallback to `local` behavior.
