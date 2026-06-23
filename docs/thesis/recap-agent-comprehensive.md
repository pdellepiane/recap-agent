# recap-agent — Documentación integral del proyecto

> **Fuentes:** `README.md`, `AGENTS.md`, `docs/implementation-log.md` (2480 líneas),
> `docs/evaluation-framework.md`, `docs/channel-integration.md`,
> `docs/knowledge-base-integration.md`, `docs/feedback-implementation-plan.md`,
> `docs/feedback-test-coverage.md`, `docs/provider-vector-search.md`,
> `docs/aws-auth-setup.md`, `analysis/` (4 dossier), código fuente (`src/`, `infra/`, `prompts/`).
>
> **Generado:** 2026-06-09

---

## 1. Resumen ejecutivo

**recap-agent** es un agente conversacional serverless desplegado sobre AWS Lambda, diseñado para asistir a usuarios de **Sin Envolturas** en la planificación de eventos. Modelado en torno a un grafo de estados explícito (26 nodos), combina el SDK de OpenAI Agents (un agente conversacional `gpt-5.4-mini` + un extractor estructurado `gpt-5.4-nano`), persistencia por turno en DynamoDB, una puerta de enlace real contra el marketplace de Sin Envolturas, y una búsqueda híbrida (API + vector store) para proveedores.

El runtime es **agnóstico al canal**: WhatsApp, webchat y la terminal CLI se resuelven en una capa de adaptadores delgada. La salida del modelo se parsea en estructuras tipadas antes de llegar a los renderers, y los diagnósticos solo se exponen cuando el cliente declara `client_mode=cli`.

**Principios rectores:**
- El modelo **interpreta**; el código de aplicación **decide** las consecuencias.
- **Plan de evento primero** (event-plan-first): múltiples necesidades de proveedores en un solo plan.
- **Prompts como contrato**: cada nodo del grafo define su comportamiento vía bundles versionados en español.
- **Telemetría barata y útil**: registro por turno con TTL configurable, con resúmenes estructurados.

---

## 2. Arquitectura del sistema

### 2.1 Estructura de capas

```
┌──────────────────────────────────────────────────────┐
│  CANAL: terminal (CLI), whatsapp, webchat             │
│  Adaptadores delgados: auth, render, idempotencia     │
├──────────────────────────────────────────────────────┤
│  ENTRY POINT: src/lambda/handler.ts                   │
│  Lambda Function URL → POST / (sin auth en dev)       │
│  - Valida request body                                │
│  - Invoca AgentService.handleTurn()                   │
│  - Serializa respuesta + telemetría                   │
│  - Persiste TurnPerfRecord en DynamoDB                │
├──────────────────────────────────────────────────────┤
│  RUNTIME: src/runtime/                                │
│  agent-service.ts (orquestador de turno)              │
│  openai-agent-runtime.ts (SDK de OpenAI Agents)       │
│  sinenvolturas-gateway.ts (puerta de enlace API)      │
│  provider-vector-search.ts (búsqueda semántica)        │
│  message-renderer.ts (render por canal)               │
│  prompt-loader.ts + prompt-manifest.ts                │
│  extraction-schemas.ts, close-flow-schemas.ts         │
│  provider-fit.ts (reranking determinista)             │
│  config.ts (configuración tipada Zod)                 │
├──────────────────────────────────────────────────────┤
│  CORE: src/core/                                      │
│  decision-nodes.ts (26 nodos del grafo)               │
│  plan.ts (modelo del plan persistente)                │
│  decision-flow.ts (resolución de nodo de reanudación) │
│  turn-decision.ts (TurnDecision como contrato)        │
│  sufficiency.ts (suficiencia de búsqueda)             │
│  event-type.ts, provider-category.ts, price-level.ts  │
│  event-provider-priorities.ts                         │
│  trace.ts (modelo de traza por turno)                 │
├──────────────────────────────────────────────────────┤
│  STORAGE: src/storage/                                │
│  plan-store.ts (interfaz + DynamoPlanStore + InMemory)│
│  perf-store.ts (interfaz + DynamoPerfStore + Noop)    │
├──────────────────────────────────────────────────────┤
│  INFRA: infra/cloudformation/stack.yaml                │
│  Lambda + DynamoDB (plans, perf) + Function URL + IAM │
│  infra/knowledge-sync.yml (KB sync Lambda)            │
│  infra/provider-sync.yml (provider vector sync Lambda)│
└──────────────────────────────────────────────────────┘
```

### 2.2 Despliegue en AWS

| Componente | Stack | Recurso |
|---|---|---|
| Runtime principal | `recap-agent-runtime` | Lambda `nodejs24.x`, 90s timeout, 1024 MB |
| Planes | `recap-agent-runtime` | DynamoDB `PAY_PER_REQUEST`, PK `(channel, externalUserId)` |
| Telemetría | `recap-agent-runtime` | DynamoDB con GSI `channel-user-turns` + TTL (`PERF_RETENTION_DAYS`) |
| Secreto OpenAI | `recap-agent-runtime` | Secrets Manager (sync desde `.env` en deploy) |
| Endpoint HTTP | `recap-agent-runtime` | Function URL sin auth (desarrollo) |
| Sync de KB | `recap-agent-knowledge-sync-dev` | Lambda semanal + EventBridge + S3 |
| Sync de proveedores | `recap-agent-provider-sync-dev` | Lambda semanal + EventBridge + S3 |

**IAM mínimo:** DynamoDB `GetItem`/`PutItem` + Secrets Manager `GetSecretValue` + CloudWatch Logs.

### 2.3 Variables de entorno clave

| Variable | Default | Propósito |
|---|---|---|
| `OPENAI_MODEL` | `gpt-5.4-mini` | Modelo de respuesta |
| `OPENAI_EXTRACTOR_MODEL` | `gpt-5.4-nano` | Modelo extractor |
| `OPENAI_PROMPT_CACHE_RETENTION` | `in-memory` | Retención de caché de prompts |
| `AWS_REGION` | `us-east-1` | Región AWS |
| `PLANS_TABLE_NAME` | `recap-agent-plans` | Tabla de planes |
| `PROMPTS_DIR` | `/var/task/prompts` | Ruta al bundle de prompts |
| `SINENVOLTURAS_BASE_URL` | `https://api.sinenvolturas.com/api-web/vendor` | API del marketplace |
| `SINENVOLTURAS_GUEST_SERVICE_BASE_URL` | `https://se-v2-api-dev.jnq.io/api/guest-service` | API de invitados (lookup anónimo) |
| `SINENVOLTURAS_GUEST_AUTH_BASE_URL` | `https://se-v2-api-dev.jnq.io/api-web/user` | API de autenticación de invitados (login code + verify) |
| `PROVIDER_SEARCH_MODE` | `hybrid` | `api` / `vector` / `hybrid` |
| `PROVIDER_SEARCH_LIMIT` | 12 | Candidatos persistidos |
| `REPLY_PROVIDER_LIMIT` | 6 | Top que recibe el LLM |
| `PRESENTATION_PROVIDER_LIMIT` | 6 | Top visible al usuario |
| `PROVIDER_DETAIL_LOOKUP_LIMIT` | 3 | Detalles enriquecidos por turno |
| `PROVIDER_VECTOR_STORE_ID` | (vacío) | ID del vector store de proveedores |
| `PROVIDER_VECTOR_MAX_RESULTS` | 24 | Resultados máximos del vector search |
| `PROVIDER_VECTOR_SCORE_THRESHOLD` | 0.2 | Umbral de score |
| `KB_ENABLED` | `true` | Habilita la base de conocimiento |
| `KB_VECTOR_STORE_ID` | (vacío) | ID del vector store de FAQ |
| `PERF_TABLE_NAME` | `recap-agent-runtime-perf` | Tabla de telemetría |
| `PERF_RETENTION_DAYS` | 30 | TTL de registros de perf |
| `DEFAULT_INBOUND_CHANNEL` | `terminal_whatsapp` | Canal por defecto |
| `AGENT_FEATURE_PROVIDER_PLANNING` | `true` | Feature flag: planificación |
| `AGENT_FEATURE_PROVIDER_SEARCH` | `true` | Feature flag: búsqueda |
| `AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS` | `true` | Feature flag: cotizaciones |
| `AGENT_FEATURE_FAQ` | `true` | Feature flag: FAQ |
| `AGENT_FEATURE_INVITED_EVENT_LOOKUP` | `true` | Feature flag: eventos invitado |

---

## 3. Núcleo de dominio (`src/core/`)

### 3.1 Grafo de decisión (26 nodos)

Definido en `src/core/decision-nodes.ts` como una const tuple validada con Zod:

```
contacto_inicial        → primer contacto, sin plan previo
deteccion_intencion     → clasificación de la intención del usuario
existe_plan_guardado    → reanudación de plan existente
entrevista              → recolección de datos del evento
elicitacion_necesidades → identificación de frentes de proveedores
minimos_para_buscar     → verificación de requisitos mínimos
aclarar_pedir_faltante  → solicitud de datos faltantes
usuario_responde        → procesamiento de respuesta del usuario
buscar_proveedores      → ejecución de búsqueda
busqueda_exitosa        → búsqueda completada con éxito
hay_resultados          → resultados disponibles
recomendar              → presentación de recomendaciones
refinar_criterios       → ajuste de criterios de búsqueda
usuario_elige_proveedor → confirmación de selección
anadir_a_proveedores_recomendados → adición a favoritos
seguir_refinando_guardar_plan     → continuación del plan
continua                → transición a siguiente necesidad
accion_final_exitosa    → acción final completada
necesidad_cubierta      → necesidad satisfecha
crear_lead_cerrar       → flujo de cierre con cotización
guardar_seleccion_reintentar_luego → guardar para reintentar
guardar_cerrar_temporalmente       → pausa temporal
informar_error_reintento           → notificación de error
reintentar              → reintento de búsqueda
consultar_faq           → modo FAQ / base de conocimiento
consultar_evento_invitado → consulta de evento como invitado (auth determinista, ver §4.3.1)
```

**Nodos que persisten el plan tras extracción:**
`deteccion_intencion`, `entrevista`, `elicitacion_necesidades`, `aclarar_pedir_faltante`, `refinar_criterios`, `seguir_refinando_guardar_plan`.

### 3.2 Modelo del plan (`plan.ts`)

Esquema Zod con ~25 campos. Elementos clave:

| Campo | Tipo | Descripción |
|---|---|---|
| `plan_id` | string | UUID único |
| `channel` + `external_user_id` | string | Clave de partición en DynamoDB |
| `conversation_id` | string \| null | ID de la sesión de OpenAI Conversations |
| `lifecycle_state` | `active` \| `finished` | Ciclo de vida del plan |
| `current_node` | DecisionNode | Nodo activo del grafo |
| `intent` | PlanIntent \| null | Intención extraída del último turno |
| `intent_confidence` | number (0-1) \| null | Confianza del extractor |
| `event_type` | EventType \| null | Tipo canónico de evento (boda, cumpleanos, ...) |
| `vendor_category` | ProviderCategory \| null | Categoría de proveedor mencionada |
| `active_need_category` | ProviderCategory \| null | Proyección de la necesidad activa |
| `location` | string \| null | Ubicación (ej. "Lima") |
| `budget_signal` | string \| null | Señal de presupuesto (ej. "1000 soles") |
| `guest_range` | GuestRange \| null | Rango: `1-20`, `21-50`, `51-100`, `101-200`, `201+`, `unknown` |
| `preferences` / `hard_constraints` | string[] | Preferencias y restricciones |
| `missing_fields` | string[] | Campos requeridos aún no proporcionados |
| `provider_needs` | ProviderNeed[] | **Arreglo de necesidades** (múltiples frentes) |
| `contact_name`, `contact_email`, `contact_phone` | string \| null | Datos de contacto |
| `guest_auth` | GuestAuthState | Estado de autenticación de invitado (ver §4.3.1) |
| `conversation_summary` | string | Resumen acumulado de la conversación |
| `last_user_goal` | string \| null | Último objetivo expresado |
| `open_questions` | string[] | Preguntas pendientes |
| `assumptions` | string[] | Suposiciones hechas por el agente |
| `updated_at` | ISO-8601 | Timestamp de última modificación |

#### ProviderNeed (cada necesidad de proveedor)

| Campo | Tipo | Descripción |
|---|---|---|
| `category` | ProviderCategory | Categoría canónica |
| `status` | `identified` \| `search_ready` \| `shortlisted` \| `selected` \| `deferred` \| `no_providers_available` | Estado de la necesidad |
| `preferences` | string[] | Preferencias específicas |
| `hard_constraints` | string[] | Restricciones duras |
| `missing_fields` | string[] | Campos faltantes para esta necesidad |
| `recommended_provider_ids` | number[] | IDs recomendados |
| `recommended_providers` | ProviderSummary[] | Resúmenes tipados de proveedores |
| `sub_query_results` | ProviderSubQueryResult[] | Resultados de sub-consultas |
| `selected_provider_ids` | number[] | IDs seleccionados |
| `selected_provider_hints` | string[] | Pistas de selección |

#### Normalización en el boundary de carga

`normalizeRawPlan(raw)` convierte automáticamente:
- Valores de categoría no canónicos → canónicos
- `event_type` no canónico → canónico
- Campos singulares legacy (`selected_provider_id`, `selected_provider_hint`) → arreglos
- `sub_query_results` ausentes → arreglo vacío
- `guest_auth` ausente → estado `none` por defecto

**No se mantienen shims de retrocompatibilidad** — el boundary de normalización es suficiente.

#### GuestAuthState: autenticación determinista de invitado

El plan incluye un sub-estado `guest_auth` (validado por Zod) que gobierna el flujo de autenticación para `consultar_evento_invitado`:

```typescript
{
  status: 'none' | 'code_requested' | 'authenticated' |
          'email_not_found' | 'failed';
  email: string | null;           // email autenticándose
  token: string | null;           // bearer token (redactado de prompts/trazas)
  token_expires_at: string | null; // expiración del token (24h default)
  last_error: string | null;      // último error de auth
  requested_at: string | null;    // timestamp de solicitud de código
}
```

### 3.3 Intenciones del plan (`planIntentValues`)

```typescript
'elicitar_necesidades' | 'buscar_proveedores' | 'refinar_busqueda' |
'ver_opciones' | 'confirmar_proveedor' | 'modificar_plan_proveedores' |
'explicar_recomendacion' | 'detallar_proveedor' | 'retomar_plan' |
'cerrar' | 'pausar' | 'consultar_faq' | 'consultar_evento_invitado'
```

### 3.4 Tipos de evento canónicos

```typescript
'boda' | 'cumpleanos' | 'corporativo' | 'baby_shower' | 'graduacion' |
'bautizo' | 'aniversario' | 'quinceanos' | 'otro'
```

Con mapa de sinónimos para normalización (`matrimonio` → `boda`, `cumple` → `cumpleanos`, `15 anos` → `quinceanos`, etc.). `otro` representa eventos reales fuera de la taxonomía, no ausencia de evento (`null`).

### 3.5 Categorías de proveedor (17 canónicas)

```typescript
'Accesorios y zapatos' | 'Catering' | 'Hogar y deco' | 'Florería y papelería' |
'Fotografía y video' | 'Maquillaje' | 'Música' | 'Vestidos' |
'Wedding planners' | 'Otros' | 'Bebés' | 'Salud y belleza' |
'Ternos y camisas' | 'Baile' | 'Viajes' | 'Locales' | 'Licores'
```

Agrupadas en **10 buckets** para búsquedas paralelas:

| Bucket | Categorías |
|---|---|
| Bebés | Bebés |
| Fotografía y video | Fotografía y video |
| Hogar y deco | Hogar y deco |
| Wedding planners | Wedding planners |
| Catering | Catering, Licores |
| Entretenimiento | Música, Baile |
| Belleza | Salud y belleza, Maquillaje |
| Florería y papelería | Florería y papelería |
| Locales | Locales |
| Vestuario | Vestidos, Accesorios y zapatos, Ternos y camisas |
| Otros | Otros, Viajes |

### 3.6 Niveles de precio canónicos

```typescript
'low' | 'mid' | 'high' | 'very_high'
```

Normalizados desde los símbolos de la API (`$` → `low`, `$$$$` → `very_high`). El render invierte el mapeo para la presentación al usuario.

### 3.7 Rangos de invitados

```typescript
'1-20' | '21-50' | '51-100' | '101-200' | '201+' | 'unknown'
```

Parse determinista de frases como `100 invitados` → `51-100`.

### 3.8 Suficiencia de búsqueda (`sufficiency.ts`)

`computeSearchSufficiency(plan)` evalúa si el plan está listo para buscar:

- Requiere: `vendor_category` (categoría de proveedor)
- Requiere: `location` (ubicación)
- Requiere: `budget_signal` o `guest_range` (presupuesto o rango de invitados)

`computeNeedSearchSufficiencies(plan)` aplica la misma regla por necesidad.

### 3.9 TurnDecision: contrato de ruteo (`turn-decision.ts`)

Tras la extracción estructurada, el runtime acumula **evidencia de decisión** (`DecisionEvidence`) y produce un `TurnDecision` validado por Zod:

```typescript
{
  nextNode: DecisionNode;          // nodo que ejecutará la lógica
  routeKind: RouteKind;            // ask_event_context | clarify_missing_fields |
                                   // single_need_search | multi_need_search |
                                   // present_existing_shortlist | apply_selection |
                                   // modify_plan | faq | invited_event_lookup |
                                   // close | pause | error
  providerSearchMode: 'none' | 'single_need_from_plan' |
                      'multi_need_query_intents' | 'existing_shortlist';
  presentationScope: 'none' | 'single_need' | 'multi_need' |
                     'clarification' | 'close' | 'faq' | 'invited_event_lookup';
  focusNeedCategory: ProviderCategory | null;
  needsToSearch: ProviderCategory[];
  needsToPresent: ProviderCategory[];
  stopReason: string | null;
  persistReason: string;
  invariantStatus: 'valid' | 'invalid';
  invariantViolations: string[];
}
```

**Principio clave:** El modelo produce interpretación estructurada; `TurnDecision` es el contrato de ruteo que **elimina ramas legacy de reinterpretación**. Las pruebas pueden afirmar que `turn_decision.nextNode === executed_node`.

### 3.10 SessionFocus

Objeto persistente almacenado como ítem compañero en DynamoDB. Permite que un mismo usuario en la misma sesión concentre un frente de trabajo sin caer en un `active_need_category` obsoleto:

```typescript
{
  sessionId: string;
  activeNeedCategory: ProviderCategory | null;
  lastPresentedCategories: ProviderCategory[];
  lastPresentedProviderIds: number[];
  lastNode: DecisionNode | null;
  updatedAt: string;
}
```

### 3.11 Prioridades de proveedor por tipo de evento

`event-provider-priorities.ts` define qué categorías de proveedor son prioritarias ("starter") para cada tipo de evento. Ejemplos:

| Evento | Categorías starter |
|---|---|
| boda | Locales, Vestidos, Fotografía y video, Florería y papelería, Catering, Música, Wedding planners, Maquillaje |
| cumpleanos | Locales, Catering, Fotografía y video, Música, Florería y papelería |
| corporativo | Locales, Catering, Fotografía y video |
| baby_shower | Florería y papelería, Catering, Fotografía y video, Bebés |

Estas prioridades se aplican como **guardrail**: el extractor puede sugerir categorías fuera del starter set solo si el usuario las menciona explícitamente.

---

## 4. Runtime de aplicación (`src/runtime/`)

### 4.1 Pipeline de un turno (`agent-service.ts`)

Cada mensaje entrante recorre la siguiente pipeline en `AgentService.handleTurn()`:

1. **Carga del plan** desde DynamoDB por `(channel, external_user_id)`.
2. **Validación de invariantes**: si el plan está `finished`, respuesta determinista en español (sin extractor ni composición).
3. **Resolución de nodo de reanudación** (`resolveResumeNode`).
4. **Extracción estructurada** con el agente extractor (`gpt-5.4-nano`), esquema Zod `extractionSchema`.
5. **Fusión de extracción con el plan**: preserva hechos conocidos (rango de invitados, ubicación, evento) cuando la extracción devuelve `unknown` o `null`.
6. **Aplicación de operaciones estructuradas de plan** y selección de proveedor basada en `selectedProviderHint` del extractor (con respaldo determinista de alias/ordinales).
7. **Cálculo de DecisionEvidence y TurnDecision**.
8. **Decisión del modo de búsqueda**: `none`, `single_need_from_plan`, `multi_need_query_intents`, `existing_shortlist`.
9. **Búsqueda y enriquecimiento** de proveedores vía el gateway.
10. **Reranking determinista** con `providerFitCriteria`.
11. **Composición de la respuesta** con el agente conversacional (`gpt-5.4-mini`), esquema de salida estructurado por nodo.
12. **Render por canal** (`whatsapp`, `webchat`, `terminal_whatsapp`).
13. **Persistencia del plan** y construcción del `TurnPerfRecord`.

**Multi-intención:** El extractor soporta `secondaryIntents` (ej. `intent: buscar_proveedores` + `secondaryIntents: ["confirmar_proveedor"]`). `resolveEffectiveSelectionHint()` completa la pista de selección cuando `confirmar_proveedor` aparece como intención secundaria.

### 4.2 Modelo event-plan-first

El runtime está explícitamente orientado a un **plan de evento primero** (no a una búsqueda puntual):

- `provider_needs[]` — múltiples necesidades simultáneas (catering + música + fotografía).
- `active_need_category` — proyección de la necesidad activa actual.
- Prioridades por tipo de evento — filtran categorías irrelevantes (ej. "Wedding planners" no aparece para cumpleaños).
- `sub_query_results[]` — dentro de una misma necesidad, sub-consultas independientes (ej. "sushi + torta de bodas" en Catering).
- `selected_provider_ids[]` — selección múltiple por necesidad (varios proveedores para el mismo frente).

### 4.3 Gateway de Sin Envolturas (`sinenvolturas-gateway.ts`)

Implementa `ProviderGateway` con 23 herramientas del SDK de OpenAI Agents:

**Descubrimiento:**
- `list_categories` — lista de categorías del marketplace
- `get_category_by_slug` — detalle de una categoría por slug
- `list_locations` — ubicaciones disponibles

**Búsqueda:**
- `search_providers_from_plan` — búsqueda guiada por el plan
- `search_providers_by_keyword` — búsqueda textual libre
- `search_providers_by_category_location` — búsqueda por categoría + ubicación
- `search_providers_by_query_intent` — búsqueda guiada por query intents
- `get_relevant_providers` — proveedores relevantes

**Detalle:**
- `get_provider_detail` — detalle completo
- `get_provider_detail_and_track_view` — detalle + tracking
- `get_related_providers` — proveedores relacionados
- `list_provider_reviews` — reseñas

**Contexto:**
- `get_event_vendor_context` — contexto de evento
- `list_event_favorite_providers` — favoritos del evento
- `list_user_events_vendor_context` — eventos del usuario

**Autenticación de invitado (no expuesta como tool al modelo):**
- `requestGuestLoginCode(email)` — envía código de login al email
- `verifyGuestLoginCode(email, code)` — verifica código y retorna bearer token
- `lookupAuthenticatedGuest(token)` — busca eventos con token autenticado

**Búsqueda anónima de invitado:**
- `lookup_user_event_context` — búsqueda de usuario por email/teléfono (sin auth)

**Cierre:**
- `create_quote_request` — solicitud de cotización
- `add_vendor_to_event_favorites` — añadir a favoritos
- `create_provider_review` — crear reseña
- `finish_plan` — cerrar plan con cotizaciones

**Estrategia de búsqueda mixta**: consulta en paralelo `GET /filtered` y `GET /filtered/full`, deduplica por ID, y combina campos para maximizar completitud. `/filtered/full` aporta `promos`, `description`, y `service/terms highlights`; `/filtered` aporta mejor `location`. Auto-fetch de hasta 4 páginas secuenciales por ventana de búsqueda.

**Manejo de ubicación dispersa**: el gateway prefiere coincidencias exactas de ciudad, pero recurre a candidatos de la categoría con metadatos más amplios cuando la granularidad de ubicación es insuficiente. Si no hay coincidencias exactas de ciudad, los proveedores con ubicación a nivel país siguen siendo elegibles.

**Alias de venue/local**: `categoryAliases()` normaliza `local`, `locales`, `venue`, `place`, `lugar`, `salon`, `espacio`, `recepcion` a búsquedas de `Locales`. Si `category + location` devuelve vacío, reintenta con `category-only`.

**Selección determinista final**: `selectProvidersForPlan()` aplica un selector de categoría/ubicación a TODOS los resultados (API, vector, híbrido). Esto garantiza que los candidatos vectoriales de otros países no lleguen al modelo.

#### 4.3.1 Autenticación determinista de invitado

El nodo `consultar_evento_invitado` implementa un flujo de autenticación completamente determinista, gestionado por `AgentService.resolveInvitedEventAuthentication()`. El modelo **nunca decide** si autenticar, enviar código, verificar código o llamar al lookup autenticado.

**Máquina de estados de `guest_auth`:**

```
none → code_requested → authenticated → (lookup exitoso)
                           ↓                ↓
                      email_not_found    token expirado/falló
                           ↓                ↓
                        reset            re-auth
```

**Flujo determinista (6 pasos):**

1. **Resolver email**: `resolveGuestAuthEmail()` busca en `plan.contact_email`, extrae del mensaje del usuario con regex, o usa `plan.external_user_id` si es email. Si no hay email válido → pide correo.
2. **Validar email**: `isValidEmail()` verifica formato. Si inválido → pide correo completo.
3. **Si hay token válido**: `hasValidGuestAuthToken()` verifica `guest_auth.status === 'authenticated'` y `token_expires_at > now`. Si válido → `lookupAuthenticatedGuest(token)` directo. Si falla → resetea y re-autentica.
4. **Si hay código en el mensaje**: `extractGuestLoginCode()` busca un código alfanumérico de 4-8 caracteres. Si `status === 'code_requested'` y hay código → `verifyGuestLoginCode()`.
5. **Si código ya solicitado**: Pide código al usuario.
6. **Si no**: `requestGuestLoginCode(email)` → transición a `code_requested`.

**Principios de seguridad y diseño:**

| Principio | Implementación |
|---|---|
| El modelo no decide auth | `lookup_user_event_context` fue removido de `allowedTools` en `consultar_evento_invitado` |
| Token redactado | Los tokens nunca aparecen en contexto de prompt ni en inputs/outputs de traza |
| Persistencia del token | `guest_auth.token` + `token_expires_at` persisten en DynamoDB. Expiración default 24h si la API no provee una |
| Re-auth automática | Si `lookupAuthenticatedGuest()` falla con token válido, se resetea `guest_auth` y se reinicia el flujo |
| Trazabilidad | `requestGuestLoginCode`, `verifyGuestLoginCode`, y `lookupAuthenticatedGuest` se registran en `tools_called` con `tool_inputs` que redactan el token |

**Configuración:** `SINENVOLTURAS_GUEST_AUTH_BASE_URL` (default `https://se-v2-api-dev.jnq.io/api-web/user`) — endpoint base para los tres métodos de auth. Inyectado en Lambda vía CloudFormation y `scripts/deploy.mjs`.

### 4.4 Búsqueda híbrida con vector store (`provider-vector-search.ts`)

`ProviderVectorSearchGateway` consulta un vector store de OpenAI dedicado (`Sin Envolturas Provider Search`), poblado por `provider-sync` con un archivo Markdown por proveedor con frontmatter YAML.

**Tres modos** (`PROVIDER_SEARCH_MODE`):

| Modo | Comportamiento |
|---|---|
| `api` | Solo endpoints de la API REST |
| `vector` | Solo búsqueda semántica sobre el vector store |
| `hybrid` | Ambos: deduplica por ID, enriquece hits vectoriales con la API de detalle, mergea y pasa por `selectProvidersForPlan()` |

**Filtros del vector store:** Los filtros usan claves canónicas exactas (no lowercase) porque OpenAI hace matching case-sensitive. Esto se corrigió tras observar que `catering` ≠ `Catering` causaba cero resultados para Dulcefina (Catering, tortas).

**Deduplicación y merge:** `hybrid` mergea candidatos API + vector (no devuelve solo vector). `provider-vector-search` recupera candidatos; `sinenvolturas-gateway` aplica el selector de ubicación final.

**Queries paralelas por bucket:** Cuando `resolveSearchCategories` expande un bucket (ej. "Catering" → `["Catering", "Licores"]`), cada categoría dispara su propia búsqueda vectorial con el budget completo de `maxResults`. Resultados mergeados, deduplicados y ordenados globalmente por score.

### 4.5 Provider sync pipeline (`src/provider-sync/`)

Pipeline completa para poblar el vector store de proveedores:

1. **Fetcher** — obtiene todos los summaries de proveedores (paginado) + detalle de cada uno.
2. **Formatter** — escribe un archivo `.md` por proveedor con frontmatter YAML (`provider_id`, `slug`, `category`, `city`, `country`, `price_level`) y cuerpo en español (descripción, servicios, promos, términos).
3. **Uploader** — sube archivos a OpenAI, crea batch en el vector store con atributos (`batch_id`, `source`), elimina archivos de batches anteriores.

**Stack:** `infra/provider-sync.yml`, Lambda semanal (`rate(7 days)`). Comando local: `npm run sync:providers`. Variable `PROVIDER_SYNC_SKIP_UPLOAD=true` para dry-run.

### 4.6 Provider-fit: reranking determinista (`provider-fit.ts`)

`providerFitCriteriaSchema` define criterios estructurados que el extractor DEBE emitir:

```typescript
{
  eventTypeHints: string[];      // pistas del tipo de evento
  budgetTier: PriceLevel | null; // nivel de precio objetivo
  mustHaveEvidence: string[];    // evidencia que el proveedor debe tener
  niceToHaveEvidence: string[];  // evidencia deseable
  antiEvidence: string[];        // evidencia que penaliza
}
```

El runtime aplica estos criterios de forma determinista sobre los campos del proveedor (descripción, servicios, promos, términos, nivel de precio). **El agente conversacional no rerankea proveedores**; solo decide cómo presentar el shortlist ya ordenado. Si el extractor no emite criterios, no hay fallback silencioso — se requiere extracción explícita.

**Modelo sin autoridad sobre `budgetTier`:** El runtime computa el tier de presupuesto desde `budgetSignal` (parse de "1000 soles" → `low`), no desde el criterio del modelo.

### 4.7 Renderers por canal deterministas (`message-renderer.ts`)

La salida del agente se parsea en **estructuras tipadas** (`structured-message.ts`):

| Schema | Uso |
|---|---|
| `welcomeMessageSchema` | Bienvenida con capability_lines_es dinámicas |
| `recommendationMessageSchema` | Recomendación single-need |
| `multiNeedRecommendationMessageSchema` | Recomendación multi-need (1 provider por need) |
| `closeConfirmationMessageSchema` | Confirmación de cierre |
| `closeResultMessageSchema` | Resultado del cierre |
| `contactRequestMessageSchema` | Solicitud de datos de contacto |
| `genericMessageSchema` | Fallback genérico |

**Renderers registrados:**

| Canal | Comportamiento |
|---|---|
| `whatsapp` | `*negrita*`, emojis, formato WhatsApp |
| `webchat` | Texto plano con viñetas (`-`) y URLs directas, sin Markdown |
| `terminal_whatsapp` | Igual que WhatsApp (emulación fiel) |

**El formato nunca queda a criterio del modelo.** El modelo emite IDs y rationale; los renderers poseen nombres, ubicaciones, precios, promos y enlaces de ficha.

### 4.8 Guardrails nativos del SDK de OpenAI Agents (`openai-agent-runtime.ts`)

**Input guardrail (bloqueante):** Detecta intentos de jailbreak / prompt injection (ignorar instrucciones del sistema, revelar prompts internos).

**Output guardrail (normalizante):** Si la respuesta contiene un email de soporte corrupto o no canónico (ej. `[email protected]`), lo normaliza a `hola@sinenvolturas.com`.

### 4.9 Configuración de modelos y retries

- **Cliente OpenAI:** `maxRetries: 3`
- **Runner del SDK:** `retryPolicies.any(retryPolicies.httpStatus([429]), retryPolicies.networkError())` con backoff exponencial (1s → 30s, multiplier 2, jitter true)
- **Prompt cache:** `cacheKey` estable por bundle (`extractor:<id>`, `reply:<node>:<id>`), retención `in-memory` o `24h`
- **Model settings:** `reasoning.effort: none`, `text.verbosity: low` para minimizar latencia
- **Snapshots compactos:** El extractor recibe solo rank, id, title de hasta 4 providers; la respuesta recibe top-15 con campos optimizados

### 4.10 finish_plan: cierre con cotización real (`finish-plan-tool.ts`)

`finish_plan` itera sobre todas las `provider_needs` con `selected_provider_id` poblado:

1. Lee `contact_name`, `contact_email`, `contact_phone` del plan.
2. Por cada proveedor seleccionado, llama a `POST /api-web/vendor/quote` con:
   - `phoneExtension: '+51'`
   - `eventDate: today` (requerido por la API: fecha hoy o futura)
   - `guestsRange` del plan
   - `description` del `conversation_summary`
   - `userId` omitido (camino de invitado)
3. Retorna `{ status: 'success' | 'partial' | 'failed', outcomes: [...] }`.
4. En éxito, muta el plan: `lifecycle_state → 'finished'`, `current_node → 'necesidad_cubierta'`.

**Validación de teléfono:** Parser tipado (`phone.ts`) que rechaza números incompletos. Para Perú requiere `+51` + 9 dígitos. `finish_plan` divide el código de país en el boundary del gateway.

### 4.11 Feature flags dinámicos

Los feature flags (`AGENT_FEATURE_*`) controlan el menú de bienvenida dinámico (`capability_lines_es` en `welcomeMessageSchema`). Si `AGENT_FEATURE_FAQ=false`, la capability de FAQ no aparece en el mensaje de bienvenida. Los flags se pasan como variables de entorno → CloudFormation → handler → runtime.

---

## 5. Sistema de prompts

### 5.1 Estructura de `prompts/`

```
prompts/
  shared/
    base_system.txt           → identidad y alcance del asistente
    domain_scope.txt           → límites de competencia
    domain_knowledge.txt       → terminología de Sin Envolturas
    output_style.txt           → reglas de estilo de salida
    flow_discipline.txt        → disciplina de flujo conversacional
    question_strategy.txt      → estrategia de preguntas
    common_anti_patterns.txt   → anti-patrones a evitar
  extractors/
    system.txt                 → objetivo del extractor
    field_definitions.txt      → definición de cada campo de extracción
    conflict_resolution.txt    → resolución de conflictos entre campos
    domain_knowledge.txt       → conocimiento de dominio para extracción
    normalization_rules.txt    → reglas de normalización
    examples.md                → ejemplos multi-intención, cambio de necesidad, etc.
  nodes/<nodo>/
    system.txt                 → objetivo y restricciones del nodo
    response_contract.txt      → contrato de la salida estructurada esperada
    tool_policy.txt            → herramientas permitidas en este nodo
    transition_policy.txt      → reglas de transición (solo para nodos informativos)
```

### 5.2 Manifiesto de prompts por nodo (`prompt-manifest.ts`)

Cada nodo declara qué archivos de prompt se cargan y qué herramientas (`ToolName[]`) están permitidas:

| Nodo | Herramientas permitidas |
|---|---|
| `contacto_inicial` | ninguna |
| `entrevista` | `list_categories`, `get_category_by_slug`, `list_locations` |
| `elicitacion_necesidades` | `get_provider_detail`, `list_provider_reviews` |
| `buscar_proveedores` | `search_providers_from_plan`, `search_providers_by_keyword`, `search_providers_by_category_location`, `get_relevant_providers` |
| `recomendar` | `get_provider_detail`, `get_related_providers`, `list_provider_reviews` |
| `usuario_elige_proveedor` | `get_provider_detail`, `get_provider_detail_and_track_view` |
| `crear_lead_cerrar` | `finish_plan` |
| `reintentar` | Mismas que `buscar_proveedores` |
| `consultar_faq` | `file_search` (hosted tool del SDK, no listado en `allowedTools`) |
| `consultar_evento_invitado` | ninguna (la auth y lookup son deterministas en `AgentService`) |

**Archivos compartidos:** `base_system.txt`, `domain_scope.txt`, `domain_knowledge.txt`, `output_style.txt`, `flow_discipline.txt`, `question_strategy.txt`, `common_anti_patterns.txt` se cargan para TODOS los nodos conversacionales.

**Archivos del extractor:** `system.txt`, `field_definitions.txt`, `conflict_resolution.txt`, `domain_knowledge.txt`, `normalization_rules.txt`, `examples.md`.

### 5.3 Transición a TurnDecision

Desde 2026-06-04, los archivos `transition_policy.txt` **ya no se cargan en los bundles conversacionales**. El modelo de respuesta recibe el contexto determinista del `TurnDecision` en lugar de políticas de grafo estáticas. Solo los nodos informativos (`consultar_faq`, `consultar_evento_invitado`) conservan `transition_policy.txt` para guiar la salida de su modo.

---

## 6. Base de conocimiento (FAQ)

### 6.1 Arquitectura

```
sinenvolturas.tawk.help (Tawk help center)
    ↓ scrape (manual, local — Tawk bloquea IPs cloud)
S3: knowledge-sync/dev/articles-latest.zip
    ↓ Lambda trigger (manual o EventBridge semanal)
Lambda: recap-agent-knowledge-sync-dev
    ↓ upload batch + cleanup
OpenAI Vector Store (vs_69f0ed048b7c8191b037d68ed6e25956)
    ↓ file_search tool
Nodo consultar_faq (runtime principal)
```

### 6.2 Scraper y formateador

- **Scraper** (`TawkHelpScraper`): descarga 52 artículos de `sinenvolturas.tawk.help`.
- **Formateador**: un archivo `.md` por artículo con frontmatter YAML:

```yaml
---
title: "¿Cuánto cuesta?"
slug: "cuanto-cuesta"
category: "Sobre Sin Envolturas"
article_type: "pricing"      # pricing|faq|tutorial|announcement|policy|event_guide|about
tags: ["comisiones", "transferencia", "pago"]
source_url: "https://sinenvolturas.tawk.help/article/cuanto-cuesta"
last_updated: "2025-12-15"
related_topics: ["pagos", "listas-de-regalo", "eventos"]
---
```

### 6.3 Uploader y rotación de batches

`OpenAiKnowledgeUploader`:
1. `uploadBatch()` — sube cada artículo, crea batch con `batch_id` y `source`.
2. `cleanupOldBatches()` — elimina archivos de batches anteriores.
3. Polling hasta `completed` (máx. 5 min).

### 6.4 Integración con el grafo de estados

**Nodo `consultar_faq`:**
- Entrada: extractor detecta `intent === 'consultar_faq'`.
- Comportamiento: persiste `current_node` (sin tocar `event_type`, `category`, `provider_needs`), carga bundle FAQ, responde con `file_search`.
- Salida: si el plan tiene contexto previo → `entrevista`; si no → `deteccion_intencion`.
- `file_search` está **restringido exclusivamente al nodo `consultar_faq`**. No se inyecta en otros nodos.

**Verificación de uso real:** Las trazas y los evals live comprueban que `file_search` fue efectivamente llamado (no solo disponible). FAQ exige la invocación del tool antes de responder.

### 6.5 Limitación: bloqueo de IP de Tawk

Tawk/Cloudflare bloquea requests desde AWS Lambda y GitHub Actions (HTTP 403). El scraping debe ejecutarse desde una máquina local. El Lambda solo se encarga de la subida al vector store desde S3.

---

## 7. Marco de evaluación (`src/evals/`)

### 7.1 Filosofía

Evaluación por **capas**, no por snapshots de transcript. El framework está diseñado para medir:
- Corrección de estado y flujo
- Calidad de trayectoria
- Uso de herramientas
- Manejo de proveedores
- Calidad de respuesta (tolerante, no exacta)

### 7.2 Targets

| Target | Descripción | Uso |
|---|---|---|
| `offline` | `AgentService` real con `InMemoryPlanStore`, fixture-backed gateway y runtime | CI, iteración rápida, regresiones |
| `live_lambda` | Invoca la Function URL desplegada, hidrata plan desde DynamoDB | Verificación de contrato, drift de integración |

### 7.3 Expectativas (15 familias)

| Expectativa | Tipo | Descripción |
|---|---|---|
| `node_transition` | hard | El nodo final debe ser uno de una lista permitida |
| `node_path_contains` | hard | El path de nodos debe contener un nodo específico |
| `plan_field_equals` | hard | Un campo del plan debe tener un valor exacto |
| `plan_field_subset` | hard | Un campo array del plan debe contener ciertos elementos |
| `provider_results_contains` | hard | Los resultados deben incluir ciertos provider IDs |
| `tool_usage` | hard | Las herramientas llamadas deben coincidir con lo esperado |
| `trace_field_equals` | hard | Campo de traza con valor exacto |
| `trace_field_subset` | hard | Campo de traza contiene ciertos elementos |
| `trace_field_number` | hard | Campo numérico de traza (≥, ≤, =) |
| `provider_result_count` | hard | Número de resultados de proveedor |
| `token_usage_present` | hard | Token usage no nulo (evals live) |
| `text_contains` | soft | El texto de respuesta contiene ciertas frases |
| `text_not_contains` | soft | El texto NO contiene ciertos patrones |
| `text_semantic` | soft | Juez semántico opcional (requiere `OPENAI_API_KEY`) |
| `trajectory_invariants` | hard | Invariantes de trayectoria |
| `budget_constraints` | soft | Restricciones de presupuesto |

### 7.4 Métricas SOTA (siempre activas)

Cada caso produce automáticamente:
- `tool_precision`, `tool_recall`, `tool_F1`
- `branch_coverage` (cobertura de ramas del grafo)
- `state_pass_rate` y `trajectory_pass_rate`
- `plan_persistence_rate`
- `cache_hit_rate`
- `token_totals` (extraction, reply, total)
- `latency_distribution`

### 7.5 Suites

| Suite | Casos | Uso |
|---|---|---|
| `smoke` | ~5 | Iteración activa, pre-commit |
| `dev_regression` | ~20 | Pre-merge, cambios de prompt/modelo |
| `benchmark_full` | ~30 | Comparación programada |
| `live_smoke` | ~5 | Verificación ligera contra Lambda |
| `live_comprehensive` | ~12 | Verificación multi-turn contra Lambda |
| `feedback_regression` | ~10 | Cobertura de bugs de feedback |
| `live_feedback_token_regression` | ~4 | Evals multi-turn con consumo real de tokens |

### 7.6 Artefactos por corrida

Cada run escribe en `.eval-runs/<run-id>/`:
- `results.jsonl` — una fila por caso/config/target
- `report.json` — agregado
- `report.md` — líder legible
- `dashboard.json` — KPIs estructurados para BI
- `dashboard.csv` — tabla plana para dashboards
- `artifacts/<config>/<case>.json` — sobre completo por caso

### 7.7 Concurrencia

`--parallel <n>` con pool acotado que preserva orden determinista de resultados.

### 7.8 Eval observable (`eval:observable-live`)

Runner que imprime solo la transcripción (turno del usuario → respuesta del agente) usando:
- Planificador con estado que lee el plan/trace real después de cada turno
- Orden de bloques de operación barajado (dependencias internas preservadas)
- `client_mode=cli` internamente (diagnósticos ocultos en la terminal)
- Cobertura: add, update, delete, select, unselect, replace, defer, reactivate, refine, detail, explain, compare, FAQ, close

### 7.9 Matrices de benchmark

Archivos YAML en `evals/matrices/` que permiten variar modelo de respuesta, modelo extractor, `reasoning_effort`, etiqueta de bundle de prompts, y overrides de entorno por entrada. Una corrida de matriz produce resultados comparables sin editar casos.

---

## 8. Integración de canales y telemetría

### 8.1 Contrato de request

```json
{
  "text": "Hola, necesito catering para una boda de 80 personas en Lima",
  "user_id": "whatsapp:+51999999999",
  "channel": "whatsapp",
  "message_id": "wamid.HBg...",
  "received_at": "2026-04-21T21:17:26.000Z",
  "session_id": "abc123...",
  "contact_phone": "51999999999",
  "client_mode": "channel"
}
```

### 8.2 Contrato de respuesta

**`client_mode: "channel"`** (producción):
```json
{
  "message": "¡Hola! Soy el asistente de Sin Envolturas...",
  "conversation_id": "conv_abc123",
  "plan_id": "01J...",
  "current_node": "entrevista"
}
```

**`client_mode: "cli"`** (desarrollo):
Incluye además `trace`, `perf`, y `plan` (el plan completo post-turno).

### 8.3 Responsabilidades del adaptador de canal

Fuera del runtime (en el adaptador):
- Verificación de firma del webhook
- Conversión del payload nativo al request normalizado
- Identidad de usuario externa estable
- Idempotencia por `message_id`
- Reintentos con backoff
- Renderizado del campo `message` al usuario
- Captura de feedback y estado de entrega

Dentro del runtime (no tocar):
- Carga/guardado del plan
- Extracción de intención y plan
- Búsqueda y enriquecimiento de proveedores
- Composición de respuesta en español
- Trazas y telemetría

### 8.4 Telemetría por turno

**Tabla DynamoDB:** `recap-agent-runtime-perf`

**Esquema de clave:**
- `pk = CONVERSATION#<conversation_id>`
- `sk = TURN#<captured_at>#<trace_id>`
- `gsi1pk = CHANNEL_USER#<channel>#<sha256(user_id)>`
- `gsi1sk = TURN#<captured_at>#<trace_id>`
- `ttl_epoch_seconds = captured_at + retentionDays * 86400`

**Campos persistidos (~30 campos):**

| Categoría | Campos |
|---|---|
| Identidad | `trace_id`, `conversation_id`, `plan_id`, `channel`, `external_user_hash`, `message_id` |
| Mensaje | `user_message_hash`, `user_message_preview` (160 chars), `outbound_text` |
| Nodo y path | `previous_node`, `current_node`, `node_path` |
| Intención | `intent`, `intent_confidence` |
| Herramientas | `tools_considered`, `tools_called`, `tool_call_count` |
| Búsqueda | `search_strategy`, `provider_result_count`, `provider_result_ids` |
| Embudo | `recommendation_funnel` (candidates, sent, presentation_limit) |
| Timing | `timing_ms` (plan_load, extraction, provider_search, enrichment, compose, persistence) |
| Tokens | `token_usage` (extraction, reply, total), `cache_hit_rate` |
| Extracción | `extraction_summary` (intent, category, location, budget, guest_range, preferences, constraints, hint, pause, contact) |
| Plan | `plan_summary` (node, lifecycle, event_type, active_need, location, budget, guest_range, need_categories, contact_presence, summary_preview, open_question_count) |
| Decisión | `turn_decision` (routeKind, providerSearchMode, presentationScope, focusNeedCategory) |
| Sesión | `session_id` |
| Otros | `prompt_bundle_id`, `prompt_file_paths`, `operational_note`, `missing_fields`, `lifecycle_state` |

**TTL configurable** vía `PERF_RETENTION_DAYS` (default 30). La tabla usa `PAY_PER_REQUEST` para costo mínimo.

### 8.5 Traza por turno (`TurnTrace`)

Campos clave visibles en modo CLI:

| Campo | Descripción |
|---|---|
| `trace_id` | UUID del turno |
| `previous_node` / `current_node` | Nodo antes y después |
| `node_path` | Camino completo de nodos |
| `intent` | Intención extraída |
| `prompt_bundle_id` | ID del bundle de prompts usado |
| `tools_considered` / `tools_called` | Herramientas ofrecidas y ejecutadas |
| `tool_inputs` / `tool_outputs` | Inputs/outputs de herramientas (truncados si son grandes) |
| `provider_results` | Resultados de proveedores en el turno |
| `recommendation_funnel` | Embudo de recomendación |
| `timing_ms` | Breakdown por etapa |
| `token_usage` | Tokens de extracción, respuesta y total |
| `search_strategy` | Estrategia de búsqueda usada |
| `extraction_summary` | Resumen de extracción |
| `plan_summary` | Resumen del estado del plan |
| `turn_decision` | Decisión de ruteo |
| `operational_note` | Nota operativa |
| `contact_validation_error` | Error de validación de contacto |

---

## 9. Decisiones de diseño clave

### 9.1 El modelo interpreta; el código decide

**Regla:** Nunca usar keyword matching o comparación exacta de strings para decidir el flujo conversacional. Las decisiones de flujo deben venir de extracción estructurada del LLM y evidencia de estado tipada.

**Materialización:** `TurnDecision` como contrato Zod; `DecisionEvidence` como acumulación de señales; `planOperations`, `closeActions`, `selectedProviderReferences`, `providerQueryIntents` como schemas de extracción estructurados.

### 9.2 Plan de evento primero (no búsqueda puntual)

**Regla:** El artefacto primario es un plan de evento que puede contener múltiples necesidades de proveedores. La búsqueda de un solo proveedor es un subconjunto natural.

**Materialización:** `provider_needs[]`, `active_need_category`, `sub_query_results[]`, `selected_provider_ids[]`, prioridades por tipo de evento.

### 9.3 Canales como adaptadores delgados

**Regla:** El runtime es agnóstico al canal. WhatsApp, webchat, y terminal son responsabilidad de renderers y adaptadores externos.

**Materialización:** `channel` y `user_id` como datos de entrada; `message` como campo de salida universal; `client_mode` como interruptor de diagnósticos; renderers como mapa `Record<channel, MessageRenderer>`.

### 9.4 Determinismo donde importa

Todas las decisiones de ruteo, selección de proveedor, validación de contacto, reranking y persistencia son determinísticas. Las fuentes de no-determinismo (extracción y composición del LLM) están acotadas a producir schemas estructurados que el código consume.

### 9.5 Migraciones limpias, sin shims

**Regla:** No construir ni preservar shims de retrocompatibilidad durante el desarrollo activo. Preferir rupturas limpias y re-desarrollo desde el diseño actual.

**Materialización:** `normalizeRawPlan` en el boundary de carga; purga explícita de planes antiguos; migraciones atómicas de fixtures y casos de eval.

### 9.6 Prompts como contrato versionado

**Regla:** Los prompts son archivos de texto en español bajo `prompts/`, mapeados a nodos exactos del grafo. Son parte del contrato del sistema, no configuración suelta.

**Materialización:** `prompt-manifest.ts` como fuente de verdad de qué archivos y herramientas corresponden a cada nodo; `prompt-loader.ts` como cargador con caché.

### 9.7 Telemetría barata y siempre activa

**Regla:** Cada turno produce un registro de telemetría con TTL, independientemente del canal. Los diagnósticos detallados solo se exponen en modo CLI.

**Materialización:** `TurnPerfRecord` con ~30 campos estructurados; `DynamoPerfStore` con GSI para consultas; `NoopPerfStore` como fallback.

### 9.8 Streaming fuera de alcance

**Regla:** WhatsApp no soporta streaming. El terminal emula WhatsApp y no introduce capacidades que el canal real no pueda usar.

**Materialización:** Respuesta síncrona única por turno; sin SSE ni chunked responses.

---

## 10. Hallazgos de análisis

### 10.1 Completitud de información de proveedores

**Fuente:** `analysis/provider-information-completeness/`

- Censo exhaustivo de 182 proveedores (2026-04-14).
- **Resúmenes raw de búsqueda NO son suficientes** para diferenciar: 0% de completitud en promos, website, service/terms highlights.
- **Colisiones de resumen severas**: Bebés colapsa 35 proveedores en 2 firmas; Vestidos 6 en 1; Hogar y deco 19 en 3.
- **Campos más útiles**: `promoBadge/summary` > `serviceHighlights` > `termsHighlights` > `descriptionSnippet` > precio/ubicación estructurados.
- **No confiar** en rating (4/182 no cero) ni en `eventTypes` (0%).
- **Recomendación**: priorizar limpieza por categoría (Vestidos, Bebés, Hogar y deco primero).

### 10.2 Herramientas de API implementables

**Fuente:** `analysis/vendor-endpoint-tool-readiness/`

- Dos herramientas estables: `GET /filtered/full` (read/search) y `POST /quote` (write).
- **Regla de fecha en quote**: `eventDate` debe ser hoy o futuro. Si el usuario omite fecha, el tool layer hardcodea la fecha actual.
- `/filtered/full` tiene mejor `description` (100%) y `promos` (60%), pero PEOR ubicación (0% city/state/country vs 61% de `/filtered`).
- Estrategia adoptada: usar AMBOS endpoints, mergear por ID, preferir metadata de `/filtered/full` y ubicación de `/filtered`.

### 10.3 Auditoría de búsqueda venue/local

**Fuente:** `analysis/venue-local-search-audit/`

- Solo `local` retorna proveedores de `Locales` consistentemente. `venue`, `place`, `lugar`, `salon` retornan cero.
- Causa: aliasing insuficiente en la composición de queries.
- Fix implementado: `categoryAliases()` expandido; fallback de `category + location` → `category-only`; test de regresión para `venue → local`.

### 10.4 Análisis de feedback (Batch 2)

**Fuente:** `analysis/batch2-feedback-fix-plan/`

44 turnos de conversación real (`web_chat`) analizados. Fallos principales:

| # | Falla | Causa raíz |
|---|---|---|
| 1 | Close bloqueado por shortlists no seleccionados | `agent-service.ts` no resuelve selección antes de bloquear |
| 2 | Selección de proveedor no persistida | `selectedProviderHint` no resuelto a ID |
| 3 | Teléfono incompleto aceptado (6 dígitos) | Sin validación temprana |
| 4 | Pregunta de extensión rutea a `recomendar` | Extractor no clasifica como `cerrar` |
| 5 | `ninguna` borra selección de otra necesidad | Raw text matching en lugar de structured extraction |
| 6 | Búsqueda en Lurín retorna proveedores de México | Vector search sin `selectProvidersForPlan()` |
| 7 | FAQ respuestas ambiguas | KB prompts necesitan refinamiento |

**Corrección:** Las 5 milestones del fix-plan se completaron (2026-05-20): schemas Zod para close actions, transiciones deterministas, phone parser tipado, selector de ubicación post-vector, y refinamiento de FAQ prompts.

---

## 11. Evolución del proyecto (hitos del `implementation-log.md`)

| Fecha | Hito | Impacto |
|---|---|---|
| 2026-04-05 | Esqueleto del runtime | Grafo de nodos, DynamoDB, OpenAI SDK, primer gateway |
| 2026-04-05 | Secreto en AWS Secrets Manager | API key de OpenAI resuelta en Lambda |
| 2026-04-06 | Prompts por nodo | Bundles estructurados, tool policy por nodo |
| 2026-04-07 | Configuración centralizada | `config.ts` como fuente de verdad; prohibición de `any` |
| 2026-04-07 | `nodejs24.x` end-to-end | Local + Lambda alineados en Node 24 LTS |
| 2026-04-08 | Event-plan-first | `provider_needs[]`, `active_need_category`, reescritura de prompts |
| 2026-04-12 | Marco de evaluación nativo | `src/evals/`, targets offline/live, expectativas por capas |
| 2026-04-14 | Búsqueda resiliente a ubicación dispersa | Fallback de ubicación en gateway |
| 2026-04-20 | Búsqueda mixta y embudo 15→5 | `/filtered` + `/filtered/full` merge; top-15 → top-5 |
| 2026-04-20 | `finish_plan`, ciclo de vida, TTL | `lifecycle_state`, `contact_*`, herramienta `finish_plan` |
| 2026-04-23 | Cotización real y separación pausa/cierre | `POST /api-web/vendor/quote`; `pausar` ≠ `cerrar` |
| 2026-04-28 | Integración real de KB de Tawk | Vector store FAQ, scraper, batch rotation, stack sync |
| 2026-04-30 | Renderers por canal estructurados | `structured-message.ts`, WhatsApp/webchat/terminal |
| 2026-05-05 | Heurísticas de selección multi-intención | `secondaryIntents`, `resolveEffectiveSelectionHint` |
| 2026-05-05 | Búsqueda vectorial de proveedores | `provider-sync`, modo `hybrid` |
| 2026-05-06 | Categorías canónicas y filtros vectoriales | Enum Zod único, filtros case-sensitive corregidos |
| 2026-05-07 | Múltiples proveedores por necesidad | `selected_provider_ids[]`, `selected_provider_hints[]` |
| 2026-05-14 | Normalización canónica final | EventType, PriceLevel, LocationKey canónicos; sin `actions` generadas |
| 2026-05-22 | `consultar_evento_invitado` y telemetría ampliada | Guest service lookup; resúmenes estructurados en perf |
| 2026-06-04 | `TurnDecision` autoritativo | Ruteo determinista desde evidencia estructurada |
| 2026-06-04 | Sub-queries por necesidad | `sub_query_results[]`, búsqueda independiente por componente |
| 2026-06-04 | Ignorar replace espurios en selecciones simples | `replace_provider` extra no bloquea `select_provider` válido |
| 2026-06-09 (*) | Auth determinista de invitado | `guest_auth` state machine (5 estados), login code flow, bearer token con expiración, `lookupAuthenticatedGuest()` determinista |

(*) Entrada extraída del commit `8e9bb9b` (2026-06-11) ya que el `implementation-log.md` incluía la entrada pero no se había reflejado en este documento.

---

## 12. Estructura completa del repositorio

```
recap-agent/
├── AGENTS.md                          # Convenciones del proyecto
├── README.md                          # Documentación principal
├── package.json                       # Dependencias y scripts
├── tsconfig.json                      # TypeScript strict
├── eslint.config.mjs                  # ESLint + no-any
├── .env.example                       # Template de variables
├── .nvmrc                             # Node 24
│
├── docs/
│   ├── implementation-log.md          # Log de cambios (2480 líneas)
│   ├── channel-integration.md         # Contrato de canal y telemetría
│   ├── evaluation-framework.md        # Guía del marco de evaluación
│   ├── knowledge-base-integration.md  # Arquitectura de KB
│   ├── feedback-implementation-plan.md # Plan de corrección de feedback
│   ├── feedback-test-coverage.md      # Matriz de cobertura feedback→evals
│   ├── provider-vector-search.md      # Documentación de búsqueda vectorial
│   ├── aws-auth-setup.md              # Configuración de auth AWS
│   └── thesis/
│       ├── recap-agent-doc.tex        # Artículo LaTeX en español
│       ├── recap-agent-doc.pdf        # PDF compilado
│       └── recap-agent-comprehensive.md # Este documento
│
├── prompts/
│   ├── shared/                        # 7 archivos de sistema base
│   ├── extractors/                    # 6 archivos del extractor
│   └── nodes/<nodo>/                  # 3-4 archivos por nodo (26 nodos)
│
├── src/
│   ├── core/                          # Dominio (14 archivos)
│   │   ├── decision-nodes.ts          # 26 nodos del grafo
│   │   ├── decision-flow.ts           # resolveResumeNode()
│   │   ├── plan.ts                    # Modelo del plan (Zod)
│   │   ├── turn-decision.ts           # TurnDecision + DecisionEvidence
│   │   ├── sufficiency.ts             # computeSearchSufficiency()
│   │   ├── event-type.ts              # 9 tipos canónicos
│   │   ├── provider-category.ts       # 17 categorías + 10 buckets
│   │   ├── price-level.ts             # 4 niveles de precio
│   │   ├── location.ts                # Claves de país
│   │   ├── provider.ts                # ProviderSummary
│   │   ├── provider-sub-query.ts      # Sub-query results
│   │   ├── event-provider-priorities.ts # Prioridades por evento
│   │   ├── trace.ts                   # TurnTrace schema
│   │   └── messages.ts                # NormalizedInboundMessage
│   │
│   ├── runtime/                       # Runtime (19 archivos)
│   │   ├── agent-service.ts           # Orquestador (127 KB)
│   │   ├── openai-agent-runtime.ts    # SDK de OpenAI Agents (59 KB)
│   │   ├── sinenvolturas-gateway.ts   # Gateway API (41 KB)
│   │   ├── provider-vector-search.ts  # Búsqueda vectorial
│   │   ├── provider-fit.ts            # Reranking determinista
│   │   ├── provider-sub-query-selection.ts # Selección por sub-query
│   │   ├── structured-message.ts      # Schemas de salida
│   │   ├── message-renderer.ts        # Renderers WhatsApp/WebChat
│   │   ├── extraction-schemas.ts      # Zod schemas del extractor
│   │   ├── close-flow-schemas.ts      # Schemas de cierre
│   │   ├── finish-plan-tool.ts        # Herramienta finish_plan
│   │   ├── prompt-loader.ts           # Cargador de prompts
│   │   ├── prompt-manifest.ts         # Manifiesto por nodo
│   │   ├── config.ts                  # Config tipada Zod
│   │   ├── contracts.ts               # Interfaces del runtime
│   │   ├── provider-gateway.ts        # Interfaz ProviderGateway
│   │   ├── secrets.ts                 # Resolución de secretos
│   │   ├── phone.ts                   # Parser de teléfono
│   │   └── openai-structured-schema.ts # Compatibilidad de schemas
│   │
│   ├── storage/                       # Persistencia (5 archivos)
│   │   ├── plan-store.ts              # Interfaz + tipos
│   │   ├── dynamo-plan-store.ts       # DynamoDB adapter
│   │   ├── in-memory-plan-store.ts    # In-memory adapter
│   │   ├── perf-store.ts              # Interfaz de perf
│   │   └── dynamo-perf-store.ts       # DynamoDB perf adapter
│   │
│   ├── lambda/handler.ts              # Entry point HTTP
│   ├── terminal/client.ts             # CLI de desarrollo
│   │
│   ├── knowledge-sync/                # Sync de KB (6 archivos)
│   │   ├── scraper.ts                 # TawkHelpScraper
│   │   ├── formatter.ts               # Per-article markdown
│   │   ├── openai-uploader.ts         # Upload + batch rotation
│   │   ├── sync.ts                    # Orquestador
│   │   ├── handler.ts                 # Lambda handler
│   │   └── types.ts                   # Tipos
│   │
│   ├── provider-sync/                 # Sync de proveedores (6 archivos)
│   │   ├── fetcher.ts                 # API data fetcher
│   │   ├── formatter.ts               # Per-provider markdown
│   │   ├── uploader.ts                # Vector store upload
│   │   ├── sync.ts                    # Orquestador
│   │   ├── handler.ts                 # Lambda handler
│   │   └── types.ts                   # Tipos
│   │
│   ├── evals/                         # Marco de evaluación (8+ archivos)
│   │   ├── cli.ts                     # CLI: run, list, report
│   │   ├── case-schema.ts             # Schemas de casos
│   │   ├── loader.ts                  # YAML/JSON loader
│   │   ├── runner.ts                  # Ejecutor
│   │   ├── reporting.ts               # Reportes
│   │   ├── targets/offline.ts         # Target offline
│   │   ├── targets/live-lambda.ts     # Target live
│   │   ├── scorers/semantic-judge.ts  # Juez semántico
│   │   ├── live-observable-cli.ts     # CLI observable
│   │   └── observable-live-script.ts  # Planificador stateful
│   │
│   └── logs/trace/perf.ts             # TurnPerfRecord builder
│
├── evals/                             # Activos de evaluación (git-tracked)
│   ├── cases/                         # 50+ escenarios YAML
│   ├── templates/                     # Plantillas base
│   ├── fixtures/                      # Planes semilla y respuestas
│   ├── suites/                        # 7 suites YAML
│   └── matrices/                      # Matrices de benchmark
│
├── tests/                             # 25 archivos de test (vitest)
├── scripts/                           # Build, deploy, purge, sync
├── infra/
│   ├── cloudformation/stack.yaml      # Stack principal
│   ├── knowledge-sync.yml             # Stack de KB
│   └── provider-sync.yml              # Stack de provider sync
├── analysis/                          # Dossier de análisis
│   ├── batch2-feedback-fix-plan/       # Análisis de feedback
│   ├── provider-information-completeness/ # Auditoría de datos
│   ├── vendor-endpoint-tool-readiness/ # Viabilidad de endpoints
│   └── venue-local-search-audit/      # Auditoría de búsqueda venue
├── feedback/                          # Imágenes de feedback (14 JPEGs)
└── .eval-runs/                        # Artefactos de eval (gitignored)
```

---

## 13. Comandos principales

```bash
# Desarrollo
npm install
npm run check          # typecheck + lint + test
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest run
npm run build          # esbuild → dist/

# Despliegue
npm run deploy         # scripts/deploy.mjs (Lambda + CloudFormation)

# Terminal (CLI contra Lambda desplegada)
npm run terminal       # Bun
npm run terminal:node  # Node (tsx)

# Evaluación
npm run eval:list                              # Listar suites
npm run eval -- --suite smoke --target offline  # Suite rápida
npm run eval -- --suite benchmark_full --target live_lambda --parallel 4
npm run eval:report -- --input .eval-runs/<run-id>
npm run eval:observable-live                   # Transcripción barajada

# Sync
npm run sync:providers                         # Sync de vector store de proveedores
npx tsx scripts/sync-knowledge-base.ts         # Sync de KB

# Purga
npm run purge:terminal-plans -- --dry-run
npm run purge:terminal-plans -- --yes
```

---

## 14. Limitaciones conocidas

1. **Tawk bloquea IPs de AWS Lambda y GitHub Actions** → el scraping de KB debe ejecutarse localmente.
2. **Function URL sin autenticación** → los adaptadores de producción deben implementar su propia capa de auth.
3. **No hay idempotencia server-side** sobre `message_id` duplicado → responsabilidad del adaptador.
4. **Streaming fuera de alcance** → por convención del proyecto (WhatsApp no lo soporta).
5. **Catálogo canónico requiere reindexación** cuando se añaden categorías o tipos de evento → migraciones disruptivas sin shims.
6. **El vector store de proveedores requiere creación manual inicial** → `npm run sync:providers` para poblarlo.
7. **`client_mode: "cli"` puede retornar traces grandes** → nunca habilitar para usuarios finales.
8. **La API de Sin Envolturas tiene campos incompletos** (~40% de proveedores con datos finos) → el agente debe priorizar campos de alta señal.
9. **Latencia de turno puede ser de decenas de segundos** → canales con webhook deadlines cortos deben hacer ack inmediato y procesar async.

---

*Documento generado a partir del análisis exhaustivo del repositorio `recap-agent` (2026-06-11).*
*Fuentes: `README.md`, `AGENTS.md`, `docs/implementation-log.md` (2514 líneas, incluyendo commit `8e9bb9b`), 6 docs técnicos, 4 dossier de análisis, código fuente (`src/`, `infra/`, `prompts/`), git log y diffs, 50+ casos de evaluación, 25 archivos de test.*
