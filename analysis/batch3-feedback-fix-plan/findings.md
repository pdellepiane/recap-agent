# Findings

## Current Understanding

- Batch 3 contains several objective assistant failures: repeated onboarding when the user asks for help, leaked internal planning fields, weak code-delivery recovery, provider selection drift, inability to clear stale blockers, single-front handling for multi-service planning, contact validation loops, event-dashboard questions routed to FAQ, leaked file citation artifacts, and insufficient turn observability for final assistant wording.
- A separate class of feedback is tonal: Gaby wants a warmer, more useful, less robotic assistant. This should be implemented as a shared personality and response-style layer used by every node, not as node-by-node wording patches.
- Some feedback changes product behavior or business policy and should be approved one by one before implementation. This includes OXXO, payment validation timing, benefit claims, label naming, marketplace-vs-planning positioning, and whether the assistant should ask for location and budget early by default.
- DynamoDB perf logs validate the relevant turn sequences for routing and state issues, especially:
  - The repeated onboarding/problem-help sequence in web chat session `701ff49783003f6463a0e7be224b83987b86a131d45046d70cf6fc461d466f32`.
  - The Baby Baloo/Baby Loli selection drift, stale unselect operation, multi-front planning request, and contact loop in session `7c89e25c2d83f309914e679c881ea84a38a943f0d955b53ccf42c7e609d3784a`.
  - The confirmed-guests lookup routed through FAQ in session `5888aaff88370f074b6ee1e346f7ca6a5645521899dfe08f824c8d6974e3ab36`.
- DynamoDB perf logs do not persist final assistant output evidence today. Exact text defects such as command-like contact prompts, repeated welcome menus, and `filecite` leakage remain validated by the PDF and screenshots, not by DynamoDB. The fix plan adds a scalable privacy-aware outbound observability item so future investigations can validate these classes from logs.

## Fix Grouping

- Routing and state integrity: fix together because these share structured extraction, state-machine transitions, and plan operation handling.
- Output hygiene and rendering: fix together because these can be centralized around render-time sanitization and user-facing label mapping.
- System-wide tone/personality: fix together as a shared prompt included across every response node.
- Approval-gated product decisions: keep out of direct implementation until each item is accepted.
