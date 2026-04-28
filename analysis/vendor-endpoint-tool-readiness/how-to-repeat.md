# How To Repeat

## Prerequisites

- Repo at `recap-agent` root.
- Local swagger file available at `/Users/leonardocandio/Downloads/se-vendor-swagger.yaml`.
- Network access to `https://api.sinenvolturas.com`.
- Node.js available for quick validation scripts.

## Commands

```bash
# 1) Scaffold dossier (skip if already exists)
python3 /Users/leonardocandio/.codex/skills/analyze-data-sources/scripts/scaffold_analysis.py \
  --repo-root "/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent" \
  --topic "vendor-endpoint-tool-readiness" \
  --date "2026-04-20"

# 2) Extract endpoint + constraint signals from swagger
rg -n "^\\s*/|operationId:|summary:|description:|parameters:|requestBody:|responses:" \
  "/Users/leonardocandio/Downloads/se-vendor-swagger.yaml"

rg -n "format:\\s*date|date-time|minimum|exclusiveMinimum|minLength|maxLength|enum:|pattern:|today|hoy|from|to|start|end|event_date|fecha" \
  "/Users/leonardocandio/Downloads/se-vendor-swagger.yaml"

# 3) Validate quote date constraint without creating side effects
node -e 'const url="https://api.sinenvolturas.com/api-web/vendor/quote"; const base={name:"Test User",email:"test@example.com",phone:"987654321",phoneExtension:"+51",guestsRange:"80-150",description:"Solicitud de prueba para validar fechas en API",benefitId:999999}; const day=new Date(); const yyyy=day.getUTCFullYear(); const mm=String(day.getUTCMonth()+1).padStart(2,"0"); const dd=String(day.getUTCDate()).padStart(2,"0"); const today=yyyy+"-"+mm+"-"+dd; const yesterdayDate=new Date(Date.UTC(yyyy,day.getUTCMonth(),day.getUTCDate()-1)); const y=yesterdayDate.getUTCFullYear()+"-"+String(yesterdayDate.getUTCMonth()+1).padStart(2,"0")+"-"+String(yesterdayDate.getUTCDate()).padStart(2,"0"); (async()=>{for(const eventDate of [y,today]){const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...base,eventDate})}); const j=await r.json(); console.log(JSON.stringify({eventDate,status:r.status,errors:j?.errors??null,error:j?.error??null},null,2));}})();'

# 4) Coverage pass for new endpoint
node -e 'const base="https://api.sinenvolturas.com/api-web/vendor/filtered/full"; const present=v=>v!==null&&v!==undefined&&(!(typeof v==="string")||v.trim().length>0); const stats={total:0,fields:{info_desc:0,event_types:0,price_min:0,price_max:0,price_level:0,price_currency:0,location_address:0,location_city:0,location_state:0,location_country:0,contact_opening_hours:0,promos_any:0,promos_badge:0,promos_subtitle:0,flags_any_true:0,is_top_rating:0,is_top_favorites:0,is_top_quotes:0,is_top_views:0,is_new:0}}; (async()=>{let page=1,last=1; do{const r=await fetch(base+"?page="+page); const j=await r.json(); const data=j?.data?.data??[]; last=j?.data?.last_page??page; for(const p of data){stats.total++; const info=Array.isArray(p.info)?p.info:[]; if(info.some(i=>present(i?.description))) stats.fields.info_desc++; const ev=Array.isArray(p.event_types)?p.event_types:[]; if(ev.length>0) stats.fields.event_types++; const price=p.price??{}; if(present(price.min)) stats.fields.price_min++; if(present(price.max)) stats.fields.price_max++; if(present(price.level)) stats.fields.price_level++; if(present(price.currency)) stats.fields.price_currency++; const loc=p.location??{}; if(present(loc.address)) stats.fields.location_address++; if(present(loc.city)) stats.fields.location_city++; if(present(loc.state)) stats.fields.location_state++; if(present(loc.country)) stats.fields.location_country++; const contact=p.contact??{}; if(present(contact.opening_hours)) stats.fields.contact_opening_hours++; const promos=Array.isArray(p.promos)?p.promos:[]; if(promos.length>0) stats.fields.promos_any++; if(promos.some(pr=>present(pr?.badge))) stats.fields.promos_badge++; if(promos.some(pr=>present(pr?.subtitle))) stats.fields.promos_subtitle++; const flags=p.flags??{}; const anyTrue=Object.values(flags).some(v=>v===true); if(anyTrue) stats.fields.flags_any_true++; if(flags.is_top_rating===true) stats.fields.is_top_rating++; if(flags.is_top_favorites===true) stats.fields.is_top_favorites++; if(flags.is_top_quotes===true) stats.fields.is_top_quotes++; if(flags.is_top_views===true) stats.fields.is_top_views++; if(flags.is_new===true) stats.fields.is_new++; } page++; }while(page<=last); const completeness=Object.fromEntries(Object.entries(stats.fields).map(([k,v])=>[k,{present:v,total:stats.total,completeness:stats.total?Number((v/stats.total).toFixed(3)):0}])); console.log(JSON.stringify({generatedAt:new Date().toISOString(),endpoint:base,totalProviders:stats.total,completeness},null,2)); })();'

# 5) Coverage baseline for legacy endpoint
node -e 'const base="https://api.sinenvolturas.com/api-web/vendor/filtered"; const present=v=>v!==null&&v!==undefined&&(!(typeof v==="string")||v.trim().length>0); const stats={total:0,fields:{category:0,location_any:0,price_level:0,min_price:0,max_price:0,promos_any:0,info_translations_any:0,event_types:0,social_networks_any:0,rating_any:0,rating_nonzero:0}}; (async()=>{let page=1,last=1; do{const r=await fetch(base+"?page="+page); const j=await r.json(); const data=j?.data?.data??[]; last=j?.data?.last_page??page; for(const p of data){stats.total++; if(present(p?.category)) stats.fields.category++; const city=(typeof p?.city==="string"?p.city:p?.city?.name); const country=(typeof p?.country==="string"?p.country:p?.country?.name); if(present(city)||present(country)) stats.fields.location_any++; if(present(p?.price_level)) stats.fields.price_level++; if(present(p?.min_price)) stats.fields.min_price++; if(present(p?.max_price)) stats.fields.max_price++; const promos=Array.isArray(p?.promos)?p.promos:[]; if(promos.length>0) stats.fields.promos_any++; const info=Array.isArray(p?.info_translations)?p.info_translations:[]; if(info.length>0) stats.fields.info_translations_any++; const ev=Array.isArray(p?.event_types)?p.event_types:[]; if(ev.length>0) stats.fields.event_types++; const sn=Array.isArray(p?.social_networks)?p.social_networks:[]; if(sn.length>0) stats.fields.social_networks_any++; if(present(p?.rating)){stats.fields.rating_any++; const rv=Number(p.rating); if(Number.isFinite(rv)&&rv>0) stats.fields.rating_nonzero++;}} page++; }while(page<=last); const completeness=Object.fromEntries(Object.entries(stats.fields).map(([k,v])=>[k,{present:v,total:stats.total,completeness:stats.total?Number((v/stats.total).toFixed(3)):0}])); console.log(JSON.stringify({generatedAt:new Date().toISOString(),endpoint:base,totalProviders:stats.total,completeness},null,2)); })();'
```

## Expected Outputs

- `analysis/vendor-endpoint-tool-readiness/artifacts/`
  - `vendor-endpoint-tool-matrix.json`
  - `quote-date-validation-2026-04-20.json`
  - `filtered-full-coverage-2026-04-20.json`
  - `filtered-legacy-coverage-2026-04-20.json`
  - `endpoint-coverage-comparison-2026-04-20.json`

## Validation

- Confirm swagger parsing still shows exactly two vendor operations:
  - `GET /api-web/vendor/filtered/full`
  - `POST /api-web/vendor/quote`
- Confirm date check output includes:
  - past date request with `eventDate` validation error;
  - today-date request without `eventDate` error.
- Confirm coverage output includes `totalProviders: 181` on both endpoints in this snapshot run.
- Confirm deltas show `filtered/full` improves `info` and `promos` coverage while location city/state/country remains sparse.
- Reconcile artifacts with `findings.md` and `sources.md`.
