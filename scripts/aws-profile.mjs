import { execFileSync } from 'node:child_process';

export const REQUIRED_AWS_PROFILE = 'se-dev';
export const REQUIRED_AWS_REGION = 'us-east-1';
export const REQUIRED_AWS_ACCOUNT_ID = '684516060775';

export function createRequiredAwsEnv(sourceEnv = process.env) {
  const requestedProfile = sourceEnv.AWS_PROFILE;
  if (requestedProfile && requestedProfile !== REQUIRED_AWS_PROFILE) {
    throw new Error(
      `Refusing AWS access with profile ${requestedProfile}. This repository requires ${REQUIRED_AWS_PROFILE}.`,
    );
  }

  const requestedRegion = sourceEnv.AWS_REGION;
  if (requestedRegion && requestedRegion !== REQUIRED_AWS_REGION) {
    throw new Error(
      `Refusing AWS access in region ${requestedRegion}. This repository requires ${REQUIRED_AWS_REGION}.`,
    );
  }

  return {
    ...sourceEnv,
    AWS_PROFILE: REQUIRED_AWS_PROFILE,
    AWS_REGION: REQUIRED_AWS_REGION,
    AWS_SDK_LOAD_CONFIG: '1',
    AWS_PAGER: '',
  };
}

export function assertRequiredAwsIdentity(awsEnv) {
  const accountId = execFileSync(
    'aws',
    [
      'sts',
      'get-caller-identity',
      '--profile',
      REQUIRED_AWS_PROFILE,
      '--query',
      'Account',
      '--output',
      'text',
    ],
    { env: awsEnv, encoding: 'utf8' },
  ).trim();

  if (accountId !== REQUIRED_AWS_ACCOUNT_ID) {
    throw new Error(
      `Refusing AWS access to account ${accountId}. Expected ${REQUIRED_AWS_ACCOUNT_ID} through ${REQUIRED_AWS_PROFILE}.`,
    );
  }
}
