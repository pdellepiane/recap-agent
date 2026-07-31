export const requiredLocalAwsProfile = 'se-dev' as const;
export const requiredLocalAwsRegion = 'us-east-1' as const;

export function configureRequiredLocalAwsProfile(input: {
  profile?: string;
  region?: string;
}): void {
  if (input.profile && input.profile !== requiredLocalAwsProfile) {
    throw new Error(
      `Refusing AWS access with profile ${input.profile}. This repository requires ${requiredLocalAwsProfile}.`,
    );
  }
  if (input.region && input.region !== requiredLocalAwsRegion) {
    throw new Error(
      `Refusing AWS access in region ${input.region}. This repository requires ${requiredLocalAwsRegion}.`,
    );
  }

  process.env.AWS_PROFILE = requiredLocalAwsProfile;
  process.env.AWS_REGION = requiredLocalAwsRegion;
  process.env.AWS_SDK_LOAD_CONFIG = '1';
  process.env.AWS_PAGER = '';
}
