export type DevelopmentStackOutputs = Partial<Record<
  'FunctionUrl' | 'PlansTableName' | 'DeploymentEnvironment', string
>>;

/** Validate before seeding state or invoking a test turn. Explicit overrides cannot bypass isolation. */
export function resolveDevelopmentTarget(
  outputs: DevelopmentStackOutputs,
  overrides: { functionUrl?: string | null; plansTableName?: string | null } = {},
): { functionUrl: string; plansTableName: string } {
  if (outputs.DeploymentEnvironment !== 'development' || !outputs.FunctionUrl || !outputs.PlansTableName) {
    throw new Error('A verified development CloudFormation stack is required for test clients.');
  }
  if ((overrides.functionUrl && overrides.functionUrl !== outputs.FunctionUrl)
    || (overrides.plansTableName && overrides.plansTableName !== outputs.PlansTableName)) {
    throw new Error('Test URL and plans table must match the verified development stack.');
  }
  return { functionUrl: outputs.FunctionUrl, plansTableName: outputs.PlansTableName };
}
