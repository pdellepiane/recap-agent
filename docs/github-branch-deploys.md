# GitHub branch-based deployments

> **Dated deployment design and setup record.** The final 29 September production promotion used the exact tested artifact through the authorized CloudFormation path. Check [the current technical report](thesis/architecture-report/recap-agent-architecture-report.pdf) and the current stack before relying on pending setup steps below.

The repository is prepared for this release model:

- pull requests into `develop` or `main` run mandatory CI;
- pushes to `develop` run CI and deploy the exact built ZIP to
  `recap-agent-runtime-dev`;
- pushes to `main` run CI but never deploy production;
- production is a manual, reviewer-gated promotion from `main` of the exact
  content-addressed S3 object currently deployed in development.

The workflows are locally complete but are not active until this commit and the
`develop` branch are pushed. No workflow, AWS bootstrap, environment, branch
rule, push, or deployment was created while preparing this migration.

## Safety properties

- The workflows pin third-party actions to commit SHAs.
- OIDC sessions must resolve to AWS account `684516060775` in `us-east-1`.
- Development and production use separate IAM roles whose trust policies are
  scoped to their GitHub environment subject.
- The deploy script still enforces the repository's `se-dev` profile name and
  account check when OIDC credentials are supplied as environment credentials.
- Development hashes the completed ZIP, supplies that hash to `deploy.mjs`, and
  uploads it under `lambda/<sha256>.zip`.
- Existing development stack parameters are preserved unless a matching
  environment variable explicitly overrides them. This prevents a GitHub
  deployment from clearing live vector-store IDs or changing model/runtime
  settings back to defaults.
- Production accepts only a 64-character digest, downloads and verifies that
  exact S3 object, requires the development stack's current `CodeS3Key` to
  match, never rebuilds, never updates secrets, and no longer re-uploads the
  object.
- Both deployment jobs share a non-cancelling concurrency group.
- Production must run from `main`, uses the protected `production`
  environment, and requires the literal confirmation `PROMOTE`.
- CloudFormation changes execute through the bounded role defined in
  `infra/cloudformation/github-actions-deployment.yaml`; the OIDC roles cannot
  directly mutate Lambda, DynamoDB, Logs, or runtime IAM resources.

## Local files

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-development.yml`
- `.github/workflows/promote-production.yml`
- `infra/cloudformation/github-actions-deployment.yaml`
- `scripts/deploy.mjs`
- `tests/github-branch-deploys.test.ts`

## One-time AWS bootstrap — prepared, not run

The account already has the GitHub OIDC provider. The existing
`recap-agent-github-actions` role is not suitable: its trust is
`repo:pdellepiane/recap-agent:*` and its permissions only cover knowledge sync.
Do not reuse it for runtime deployment.

After reviewing the template, an authorized operator can create the three
deployment roles with:

```sh
AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation deploy \
  --stack-name recap-agent-github-deployment \
  --template-file infra/cloudformation/github-actions-deployment.yaml \
  --capabilities CAPABILITY_NAMED_IAM
```

Retrieve the outputs without copying ARNs by hand:

```sh
AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation describe-stacks \
  --stack-name recap-agent-github-deployment \
  --query 'Stacks[0].Outputs' --output table
```

This bootstrap is an AWS mutation and must be reviewed separately. It is not a
runtime/Lambda deployment.

## One-time GitHub setup — requires repository admin, not run

The currently authenticated GitHub user has `WRITE`, not `ADMIN`, so the
environment, Actions-policy, and branch-protection endpoints return `403`.
An administrator must perform this section after the AWS bootstrap and before
the first workflow run.

Create `development` with only the `develop` branch allowed, and `production`
with only `main` allowed plus at least one required reviewer and
`prevent_self_review: true`. GitHub's environment API and deployment-branch
policy API are the canonical interfaces; do not leave either environment open
to every branch.

Set these environment variables in both environments:

- `ARTIFACT_BUCKET=recap-agent-artifacts-684516060775-us-east-1`
- `CLOUDFORMATION_EXECUTION_ROLE_ARN` from the bootstrap output
- `AWS_OIDC_ROLE_ARN`: the development output in `development`, and the
  production output in `production`

With an admin-authenticated GitHub CLI:

```sh
gh variable set ARTIFACT_BUCKET --env development --body recap-agent-artifacts-684516060775-us-east-1
gh variable set ARTIFACT_BUCKET --env production --body recap-agent-artifacts-684516060775-us-east-1
gh variable set CLOUDFORMATION_EXECUTION_ROLE_ARN --env development --body "$CFN_EXECUTION_ROLE_ARN"
gh variable set CLOUDFORMATION_EXECUTION_ROLE_ARN --env production --body "$CFN_EXECUTION_ROLE_ARN"
gh variable set AWS_OIDC_ROLE_ARN --env development --body "$DEV_DEPLOY_ROLE_ARN"
gh variable set AWS_OIDC_ROLE_ARN --env production --body "$PROD_DEPLOY_ROLE_ARN"
```

Set only these three secrets on `development`; production deliberately receives
none of them because it preserves the existing stack's secret ARN bindings:

```sh
gh secret set OPENAI_API_KEY --env development
gh secret set SE_API_KEY --env development
gh secret set DEV_CHANNEL_API_KEY --env development
```

The secret values must match the intended development credentials before the
first run. Never copy production channel credentials into the development
environment.

After pushing `develop`, protect both branches. At minimum:

- `develop`: pull request required, CI required, no force pushes or deletion;
- `main`: pull request required, CI required, no force pushes or deletion;
- allow only `develop` to merge into `main` as a repository policy/process;
- keep direct production deployment absent—production remains promotion-only.

The required check name must be selected from the first successful CI run,
rather than guessed before GitHub has registered it.

## First activation sequence

1. Review and commit the migration locally.
2. Run the AWS bootstrap and configure the two GitHub environments as above.
3. Push `main` containing the workflows. This runs CI only; it cannot deploy
   production.
4. Push the existing local `develop` branch. This runs CI and then the first
   development deployment.
5. Confirm the development stack's `CodeS3Key`, Lambda health, and mandatory
   live behavior gate for any conversational change before promotion.
6. Configure required branch checks after GitHub has registered the check name.
7. Run two additional manual development deployments from `develop` to obtain
   three clean runs if that rollout criterion is retained.
8. Promote only a digest that is still the development stack's current
   `CodeS3Key`, from the `main` version of `promote-production.yml`, after a
   production reviewer approves it.

## Current exact-artifact state (2026-09-17)

- development: `lambda/11c617025de3a811de40b950973a2feed0af161ee5f1c0ed80dddad4801e4cbd.zip`
- production: `lambda/66891e9e71b951a91806fb239670050ae5d9e387b0bdb97092e927d6dd929946.zip`
- local `.artifacts/recap-agent.zip` SHA-256:
  `11c617025de3a811de40b950973a2feed0af161ee5f1c0ed80dddad4801e4cbd`
- local ZIP MD5 equals the current S3 object's ETag:
  `fd2b23ec3bdcfd3edc8fd10d7c521b3c`

The byte-level promotion precondition currently holds, and the only runtime
change is commit `01e54544` (`wait-aware reply`). The recorded live case is
8/9 because of a wording-attribution failure, so byte safety is not behavioral
release approval. Do not promote until the project owner accepts or clears that
gate.

Prepared local promotion command (not run):

```sh
DEPLOYMENT_ENV=production AWS_PROFILE=se-dev AWS_REGION=us-east-1 \
  DEPLOY_ARTIFACT_PATH=.artifacts/recap-agent.zip \
  DEPLOY_ARTIFACT_SHA256=11c617025de3a811de40b950973a2feed0af161ee5f1c0ed80dddad4801e4cbd \
  npm run deploy
```

This command is technically fail-closed against the live dev stack and exact
digest, but it is still a live production mutation and is intentionally not
part of this migration work.
