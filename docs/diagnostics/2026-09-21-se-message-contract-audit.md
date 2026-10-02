# SE conversation-message contract audit — 2026-09-21

## Scope and provenance

Read-only inspection of the production SE Agent API, not OpenAI stored messages. Latest observation: 2026-09-21 16:59:15 UTC, two existing conversation identities already documented in repository audits. Two GET requests, HTTP 200, five messages per response (ten total). An earlier same-day one-conversation sample at 16:17:26–55 UTC agrees. Credentials and customer bodies were not printed or persisted. No backend writes, AWS calls, OpenAI calls or paid evaluations occurred.

Request: GET https://api.sinenvolturas.com/api/agent/conversations/messages?phone_number=<known conversation identity>, authenticated using X-Agent-Key from existing local configuration. Only phone_number is sent. No field mask, campaign selector, event filter, pagination cursor, limit, or request body is supplied.

## Exhaustive observed shape

| Location | Observed contract |
| --- | --- |
| Envelope | data: object; status: boolean; errors: null; error: string; error_code: null |
| data | messages: array, no other keys |
| Each message | id: number; direction: string; body: string; status: string; sent_at: string; created_at: string |
| source | string in 8/10, null in 2/10 |

Observed source labels include admin_campaign, frontend_followup, external, agent and admin_manual. Recursive key inspection found no structured event_id, guest_id, campaign ID/object, template, reference, metadata, context, reply linkage or WhatsApp ID anywhere in either response. No pagination, cursor, limit or total/count metadata. Five results per request does not establish a documented five-message server limit, completeness, or lack of older messages.

The envelope status is API success, not a customer delivery state. Message status is a separate field. Null source must not be treated as a campaign.

## Useful information already present

A frontend_followup body in sample 1 contains event-category text, a recognizable date and a sinenvolturas.com/[segment]/[segment] URL. An admin_campaign body in sample 2 contains event-category text and a sinenvolturas.com/[segment] URL. Neither observed URL had a query string or fragment. Exact event titles were not validated by the privacy-preserving flag scan; an event category is not a unique title or ID.

Use message bodies as model-interpreted reference evidence. A URL may be compared with the URL/slug of an event already returned by an authorized lookup. Do not derive an event ID from opaque URL segments, fetch links automatically, treat a link as access authority, or introduce a regex intent router. Event IDs, names, slugs, URLs and dates already exist in the authorized guest-event result types and can corroborate the message reference without extending the messages endpoint.

## Current consumption

agent-conversation-gateway.ts defines messageSchema and AgentConversationMessage and explicitly maps the eight supported fields, including optional whatsapp_message_id when supplied. It does not map a structured campaign property, so future additional fields would currently be dropped. That is a future integration gap, not proof that a field was dropped in these ten live records.

turn-message-context.ts orders/deduplicates by message identity/time, selects outbound reminder-family messages, carries source/body in model history, and projects bounded campaign provenance. message-response-classifier.ts uses campaign-origin context to distinguish campaign reactions from actionable questions. Existing information/rsvp extractors permit eventHint/rsvpEventReference from relevant outbound campaign text. agent-service.ts consumes campaign context for event replies and missing-invitation handling.

Relevant implementation risks are documented in the binding work package: newest-campaign instruction overriding an explicit user target; campaign mismatch triggering a handoff without an explicit human-help request; omitted provenance in some model projections. Current gift-type handling separately omits se_store from physical fulfillment.

## Limits and disposition

This is a current sample of two real conversations, not an API-wide contract guarantee. The backend may expose newer metadata to other callers or message classes. No speculative extra query parameter is justified by the inspected client or response. Defer structured campaign/event-ID ingestion until backend documentation or a sanitized populated response establishes the exact field and meaning. Implement existing-message scope improvements now; do not block gift work or narrative campaign use on the deferred field.

Reproduce with the repository's existing SE API credential and a previously authorized conversation identity, issuing only the GET above; inspect recursive key/type distributions and sanitized context features. Do not save raw customer payloads to tracked fixtures. Use synthetic messages for implementation tests.
