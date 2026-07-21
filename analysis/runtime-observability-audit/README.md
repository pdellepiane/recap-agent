# Runtime Observability Audit

## Scope

Assess whether the deployed recap-agent runtime, provider sync, and knowledge sync
have enough logging, traces, metrics, retention, and operational controls to
interpret deployment feedback reliably.

## Current Status

- Audited on 2026-07-21 against the live `se-dev` deployment in `us-east-1`.
- Runtime request logging and successful-turn telemetry are working, but failure
  tracing, duplicate suppression, alarms, active distributed tracing, and the
  knowledge-sync maintenance path have material gaps.
- The runtime artifact deployed on 2026-07-20 at 22:38 UTC had not received a
  request when this audit ended, so feedback cannot yet be attributed to that
  exact build.

## Durable Files

- [findings.md](findings.md)
- [how-to-repeat.md](how-to-repeat.md)
- [sources.md](sources.md)
- [Latest dated note](dates/2026-07-21.md)
- [Sanitized live summary](artifacts/live-summary-2026-07-21.json)
- [WhatsApp DynamoDB/CloudWatch reconciliation](artifacts/whatsapp-reconciliation-2026-07-21.json)
