import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureRequiredLocalAwsProfile,
  requiredLocalAwsProfile,
  requiredLocalAwsRegion,
} from '../src/aws/local-profile';

describe('local AWS profile guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forces the Sin Envolturas development profile and region', () => {
    configureRequiredLocalAwsProfile({});

    expect(process.env.AWS_PROFILE).toBe(requiredLocalAwsProfile);
    expect(process.env.AWS_REGION).toBe(requiredLocalAwsRegion);
  });

  it('rejects every other profile and region', () => {
    expect(() =>
      configureRequiredLocalAwsProfile({ profile: 'default' }),
    ).toThrow('This repository requires se-dev');
    expect(() =>
      configureRequiredLocalAwsProfile({ region: 'us-east-2' }),
    ).toThrow('This repository requires us-east-1');
  });
});
