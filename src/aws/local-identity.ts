import { execFileSync } from 'node:child_process';
import { configureRequiredLocalAwsProfile, requiredLocalAwsProfile, requiredLocalAwsRegion } from './local-profile';

let verified = false;

/** Local tools that write evaluation state must verify the account before touching a table. */
export function assertRequiredLocalAwsIdentity(): void {
  configureRequiredLocalAwsProfile({ profile: process.env.AWS_PROFILE, region: process.env.AWS_REGION });
  if (verified) return;
  const account = execFileSync('aws', ['sts', 'get-caller-identity', '--profile', requiredLocalAwsProfile,
    '--region', requiredLocalAwsRegion, '--query', 'Account', '--output', 'text'],
  { encoding: 'utf8', env: process.env }).trim();
  if (account !== '684516060775') throw new Error('Refusing test state writes outside the approved AWS account.');
  verified = true;
}
