# How To Repeat

## Prerequisites

- Repository checkout at `/Users/leonardocandio/Work/thesis/recap-agent`.
- AWS credentials for profile `se-dev`.
- Local LaTeX installation with `pdflatex` and `bibtex`.
- Source template at
  `/Users/leonardocandio/Downloads/LaTeXTemplates_sullivan-business-report_v1.0`.

## Commands

```bash
pwd
rg --files -g '!*node_modules*' -g '!*.png' -g '!*.jpg' -g '!*.jpeg' -g '!*.pdf'
find docs -maxdepth 3 -type f | sort
find infra -maxdepth 4 -type f | sort
find tests -maxdepth 3 -type f | sort
find prompts -maxdepth 3 -type f | sort | wc -l
find prompts/nodes -mindepth 1 -maxdepth 1 -type d | sed 's#.*/##' | sort
find src -maxdepth 2 -type f | sort | xargs wc -l | tail -n 40

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation describe-stacks \
  --stack-name recap-agent-runtime \
  --query 'Stacks[0].{StackName:StackName,Status:StackStatus,Updated:LastUpdatedTime,Outputs:Outputs,Parameters:Parameters}' \
  --output json

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation describe-stacks \
  --stack-name recap-agent-provider-sync-dev \
  --query 'Stacks[0].{StackName:StackName,Status:StackStatus,Updated:LastUpdatedTime,Outputs:Outputs,Parameters:Parameters}' \
  --output json

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation describe-stacks \
  --stack-name recap-agent-knowledge-sync-dev \
  --query 'Stacks[0].{StackName:StackName,Status:StackStatus,Updated:LastUpdatedTime,Outputs:Outputs,Parameters:Parameters}' \
  --output json

cd docs/thesis/architecture-report
pdflatex -interaction=nonstopmode -halt-on-error recap-agent-architecture-report.tex
bibtex recap-agent-architecture-report
pdflatex -interaction=nonstopmode -halt-on-error recap-agent-architecture-report.tex
pdflatex -interaction=nonstopmode -halt-on-error recap-agent-architecture-report.tex

pdftoppm -png -f 4 -l 6 recap-agent-architecture-report.pdf ../../../tmp/pdfs/report-fixed/page
```

## Expected Outputs

- `docs/thesis/architecture-report/recap-agent-architecture-report.tex`
- `docs/thesis/architecture-report/recap-agent-architecture-report.pdf`
- `docs/thesis/architecture-report/CSSullivanBusinessReport.cls`
- `docs/thesis/architecture-report/sample.bib`

## Validation

- Confirm the final `pdflatex` run exits with code 0.
- Check the final LaTeX log for no unresolved references, no empty
  bibliography, and no overfull boxes.
- Confirm the PDF is created and has 10 pages.
- Inspect rendered pages containing figures to verify that diagram labels and
  arrows do not overlap.
