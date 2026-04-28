# How To Repeat

## Prerequisites

- Repository checked out at `recap-agent` root.
- Network access to `https://api.sinenvolturas.com`.
- Node.js runtime available (commands below use `node -e`).

## Commands

```bash
# 1) Collect live term-by-term evidence for venue-like searches
node -e 'const fs=require("node:fs"); const path=require("node:path"); const base="https://api.sinenvolturas.com/api-web/vendor"; const terms=["local","venue","place","lugar","local para eventos","salon","salon de eventos","espacio para eventos","recepcion"]; const maxPages=4; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const categoryFromLegacy=(p)=>{if(typeof p?.category==="string") return p.category; const t=p?.category?.translations; if(Array.isArray(t)){const es=t.find(x=>x?.language?.locale?.startsWith?.("es")); if(es?.name) return es.name; if(t[0]?.name) return t[0].name;} return null;}; const categoryFromFull=(p)=>p?.category?.name??null; const locationFromLegacy=(p)=>{const city=typeof p?.city==="string"?p.city:p?.city?.name; const country=typeof p?.country==="string"?p.country:p?.country?.name; return [city,country].filter(Boolean).join(", ")||null;}; const locationFromFull=(p)=>[p?.location?.address,p?.location?.city,p?.location?.state,p?.location?.country].filter(v=>typeof v==="string"&&v.trim()).join(", ")||null; async function fetchEndpoint(endpoint,term,page){const url=`${base}${endpoint}?search=${encodeURIComponent(term)}&page=${page}`; const r=await fetch(url); if(!r.ok) return {ok:false,status:r.status,url}; const j=await r.json(); const data=j?.data?.data??[]; const total=j?.data?.total??null; const lastPage=j?.data?.last_page??null; const items=data.map(p=>({id:p?.id??null,title:p?.title??p?.translations?.[0]?.title??null,slug:p?.slug??null,category:endpoint.includes("/full")?categoryFromFull(p):categoryFromLegacy(p),location:endpoint.includes("/full")?locationFromFull(p):locationFromLegacy(p)})); return {ok:true,url,total,lastPage,count:items.length,items}; } (async()=>{const out={generatedAt:new Date().toISOString(),base,maxPagesPerTerm:maxPages,terms,results:[]}; for(const term of terms){const termResult={term,endpoints:{filtered:{pages:[],totalUnique:0,categoryCounts:{}},filteredFull:{pages:[],totalUnique:0,categoryCounts:{}}}}; const byEndpoint=[["filtered","/filtered"],["filteredFull","/filtered/full"]]; for(const [key,endpoint] of byEndpoint){const seen=new Map(); for(let page=1;page<=maxPages;page++){const result=await fetchEndpoint(endpoint,term,page); termResult.endpoints[key].pages.push({page,...result}); if(result.ok){for(const item of result.items){if(item.id!==null&&!seen.has(item.id)) seen.set(item.id,item);} if(result.lastPage!==null&&page>=result.lastPage) break;} else {break;} await sleep(120);} termResult.endpoints[key].totalUnique=seen.size; const catCounts={}; for(const item of seen.values()){const cat=item.category??"(missing)"; catCounts[cat]=(catCounts[cat]??0)+1;} termResult.endpoints[key].categoryCounts=catCounts;} out.results.push(termResult);} const artifact=path.join(process.cwd(),"analysis/venue-local-search-audit/artifacts/local-venue-search-scan-2026-04-20.json"); fs.writeFileSync(artifact,JSON.stringify(out,null,2)); console.log(JSON.stringify({artifact,terms:out.results.length},null,2)); })();'

# 2) Build compact per-term hit summary
node -e 'const fs=require("node:fs"); const input=JSON.parse(fs.readFileSync("analysis/venue-local-search-audit/artifacts/local-venue-search-scan-2026-04-20.json","utf8")); const summary=input.results.map((entry)=>({term:entry.term,filteredUnique:entry.endpoints.filtered.totalUnique,filteredFullUnique:entry.endpoints.filteredFull.totalUnique,filteredCategories:Object.keys(entry.endpoints.filtered.categoryCounts),filteredFullCategories:Object.keys(entry.endpoints.filteredFull.categoryCounts)})); fs.writeFileSync("analysis/venue-local-search-audit/artifacts/local-venue-search-summary-2026-04-20.json",JSON.stringify({generatedAt:new Date().toISOString(),summary},null,2));'

# 3) Optional: check location keyword category distribution
node -e 'const fs=require("node:fs"); const base="https://api.sinenvolturas.com/api-web/vendor/filtered"; const term="Lima"; const maxPages=4; const cat=(p)=>{if(typeof p?.category==="string") return p.category; const t=p?.category?.translations; if(Array.isArray(t)){const es=t.find(x=>x?.language?.locale?.startsWith?.("es")); if(es?.name) return es.name; if(t[0]?.name) return t[0].name;} return "(missing)";}; (async()=>{const counts={}; let total=0; for(let page=1;page<=maxPages;page++){const r=await fetch(`${base}?search=${encodeURIComponent(term)}&page=${page}`); const j=await r.json(); const data=j?.data?.data??[]; for(const p of data){total++; const c=cat(p); counts[c]=(counts[c]??0)+1;} const last=j?.data?.last_page??1; if(page>=last) break;} fs.writeFileSync("analysis/venue-local-search-audit/artifacts/lima-query-category-distribution-2026-04-20.json",JSON.stringify({generatedAt:new Date().toISOString(),query:term,maxPages,totalObserved:total,categoryCounts:counts},null,2)); })();'
```

## Expected Outputs

- `analysis/venue-local-search-audit/artifacts/`
- `analysis/venue-local-search-audit/artifacts/local-venue-search-scan-2026-04-20.json`
- `analysis/venue-local-search-audit/artifacts/local-venue-search-summary-2026-04-20.json`
- `analysis/venue-local-search-audit/artifacts/lima-query-category-distribution-2026-04-20.json`

## Validation

- Confirm summary shows non-zero hits for `local` and zero hits for most other venue synonyms in the current API snapshot.
- Confirm gateway tests pass after code changes:
  - `npx vitest run tests/sinenvolturas-gateway.test.ts`
- Confirm the new regression case (`venue` fallback to `local`) passes.
