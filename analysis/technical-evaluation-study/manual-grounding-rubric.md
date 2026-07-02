# Manual Grounding Audit Rubric

Review the rows selected in `manual-grounding-audit.csv` against the
corresponding immutable case artifact.

Score each dimension as `pass`, `fail`, or `not_applicable`:

1. `provider_existence`: every named or displayed provider is present in the
   captured provider evidence.
2. `attribute_faithfulness`: factual category, location, price, promotion, and
   service attributes agree with captured evidence.
3. `rationale_support`: each reason offered for fit is supported by provider
   evidence or clearly identified user criteria.
4. `hard_constraint_consistency`: the recommendation does not contradict an
   explicit location, category, budget, or exclusion constraint.

Record the auditor identifier and concise evidence in `notes`. A recommendation
is manually grounded only when all applicable dimensions pass. When two
auditors are available, they should work independently and resolve disagreements
in a separate adjudication column before computing the final rate.
