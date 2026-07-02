# Confirmatory Gate Results

Date: 2026-07-02

## Final pre-study gate

- Runtime commit: `c384d80`
- Manifest: `technical-evaluation-50-v4`
- Deployment target: development Lambda
- Gate run: `.eval-confirmatory-gates/eval-2026-07-02T14-54-51-736Z-bc56222c`
- Cases: 13
- Harness passes: 13
- Harness failures: 0
- Runtime errors: 0
- Confirmatory gate: passed

The gate covered all five missing-location cases plus pause/resume,
multi-need, selection, no-results, recovery, corporate auditorium, and
corporate audiovisual behavior. The full 50-scenario × 3-repetition
confirmatory study was not started.

## Remaining prerequisite

The blinded worksheet `independent-grounding-review.csv` must be completed by
an independent reviewer using `manual-grounding-rubric.md`. Allowed judgments
are `pass`, `fail`, and `not_applicable`. The primary reviewer judgments must
remain hidden until the independent worksheet is complete.

## Independent review and clean-index rerun

The independent review was completed on 2026-07-02. After preserving complete
provider ficha notes, the provider index was rebuilt in vector store
`vs_6a46f023fcec8191ac12fe2c44b1612b`:

- 182 files;
- one batch (`providers-20260702T231442`);
- 182 completed;
- runtime and sync CloudFormation stacks reference the same store.

The final clean-index targeted run was
`.eval-confirmatory-gates/eval-2026-07-02T23-17-44-525Z-2b735984`.
All explicit confirmatory safety gates passed and there were no runtime errors.
The harness passed 12/13 cases: `study.birthday.02` correctly clarified the
missing location without search, but its structured event type was null rather
than `cumpleanos`. Preserve this as observed extraction instability rather than
tuning the frozen study around one stochastic miss.
