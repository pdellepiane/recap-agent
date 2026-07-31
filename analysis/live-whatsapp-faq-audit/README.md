# Live WhatsApp Question Audit

## Scope

Evaluate retained live WhatsApp question turns against runtime capabilities,
prompt wording, DynamoDB trace evidence, and CloudWatch execution logs. Focus on
gift and payment claims, fragmented messages, verification guidance, duplicate
delivery, image limitations, and user-visible English terms.

## Current Status

- Audited on 2026-07-24 using AWS profile `se-dev`.
- High confidence that the observed bad answers were routing and composition
  failures rather than Lambda infrastructure errors.
- Immediate prompt, runtime, and media-contract safeguards are deployed in
  development; validation is recorded in `docs/implementation-log.md`.

## Durable Files

- [findings.md](findings.md)
- [how-to-repeat.md](how-to-repeat.md)
- [sources.md](sources.md)
- [Latest dated note](dates/2026-07-24.md)
