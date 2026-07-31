# AWS Auth Setup

Internal note for restarting work on this repo without auth friction.

## Hard Safety Requirement

Every AWS CLI and local AWS SDK operation for this repository must use `se-dev`
in `us-east-1`. Never use the `default` profile. Repository mutation scripts
reject other profiles and verify AWS account `684516060775` before continuing.

The backing login profile currently configured on this machine is named
`se-signin`. Refresh it without changing `default`:

```bash
aws login --profile se-signin
```

## Working Local Profile

Use:

```bash
export AWS_PROFILE=se-dev
export AWS_REGION=us-east-1
export AWS_SDK_LOAD_CONFIG=1
export AWS_PAGER=
```

This profile was verified against AWS account `684516060775`.

## What Exists Locally

Current local AWS config uses:

- `se-signin` as the underlying login profile
- `se-dev` as the execution profile to use for CLI, SDKs, and Codex

The idea is: default your shell to `se-dev`, and only refresh the sign-in profile when needed.

## If Auth Expires

Refresh with:

```bash
aws login --profile se-signin
```

Then verify:

```bash
aws sts get-caller-identity --profile se-dev
```

## What To Tell Codex

Do not send secrets.

Just say the repo should use:

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1
```

That is enough for Codex to continue working from this machine.
