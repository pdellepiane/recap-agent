# How To Repeat

## Prerequisites

- Network access to `https://api.sinenvolturas.com/api-web/vendor`.
- Node.js 24 LTS, consistent with the repo runtime.
- Run from the repo root: `/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent`.

## Commands

```bash
node analysis/provider-information-completeness/artifacts/generate-provider-completeness-census.mjs \
  > analysis/provider-information-completeness/artifacts/provider-completeness-census.json

node -e "const data=require('./analysis/provider-information-completeness/artifacts/provider-completeness-census.json'); console.log(JSON.stringify({crawl:data.crawl,aggregate:data.aggregate},null,2));"

node analysis/provider-information-completeness/artifacts/generate-provider-completeness-sample.mjs \
  > analysis/provider-information-completeness/artifacts/provider-completeness-sample.json

node -e "const data=require('./analysis/provider-information-completeness/artifacts/provider-completeness-sample.json'); console.log(JSON.stringify(data.aggregate,null,2)); console.log('\nPER_CATEGORY\n'+JSON.stringify(data.perCategoryDifferentiation,null,2));"

node -e "const data=require('./analysis/provider-information-completeness/artifacts/provider-completeness-sample.json'); const flat=data.sampledProviders.flatMap((entry)=>entry.details.map((d)=>({category:entry.category.name,...d}))); const zeroRatings=flat.filter((d)=>d.rating==='0.0').length; const nonZero=flat.filter((d)=>d.rating && d.rating!=='0.0').length; const nullLoc=flat.filter((d)=>!d.location).length; const nullPrice=flat.filter((d)=>!d.priceLevel && !d.minPrice && !d.maxPrice).length; const emptyServices=flat.filter((d)=>d.serviceHighlights.length===0).length; const emptyTerms=flat.filter((d)=>d.termsHighlights.length===0).length; const emptyPromo=flat.filter((d)=>!d.promoBadge && !d.promoSummary).length; console.log(JSON.stringify({total:flat.length,zeroRatings,nonZeroRatings:nonZero,nullLocation:nullLoc,noStructuredPrice:nullPrice,emptyServices,emptyTerms,emptyPromo},null,2));"
```

## Expected Outputs

- `analysis/provider-information-completeness/artifacts/provider-completeness-census.json`
- `analysis/provider-information-completeness/artifacts/generate-provider-completeness-census.mjs`
- `analysis/provider-information-completeness/artifacts/provider-completeness-sample.json`
- `analysis/provider-information-completeness/artifacts/generate-provider-completeness-sample.mjs`

## Validation

- Confirm the census reports `totalProvidersReported`, `fetchedSummaries`, and `fetchedDetails`, and that the fetched counts match.
- Confirm the census shows `categoriesReported: 16` and a non-empty `categoryDifferentiation` breakdown.
- Confirm the JSON contains `aggregate`, `perCategoryDifferentiation`, and `sampledProviders`.
- Confirm `aggregate.summarySampleCount` and `aggregate.detailSampleCount` are both greater than zero.
- Spot-check at least one sampled provider to verify that summary fields are sparse while detail fields include description and, when available, promo or service highlights.
- Use the census as the default basis for marketplace-wide claims.
- Use the sampler only for quicker reruns or category-focused spot checks.
