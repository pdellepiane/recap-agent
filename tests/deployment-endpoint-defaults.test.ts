import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const productionHost = 'https://api.sinenvolturas.com';
const deprecatedTestHost = 'se-v2-api-dev.jnq.io';

describe('Sin Envolturas deployment endpoint defaults', () => {
  it('uses only production API defaults in active deployment and runtime configuration', () => {
    const activeFiles = [
      'scripts/deploy.mjs',
      'infra/cloudformation/stack.yaml',
      'src/runtime/config.ts',
      '.env.example',
    ].map((relativePath) => ({
      relativePath,
      content: fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8'),
    }));

    for (const file of activeFiles) {
      expect(file.content, file.relativePath).not.toContain(deprecatedTestHost);
    }

    const deployScript = activeFiles.find(
      (file) => file.relativePath === 'scripts/deploy.mjs',
    )?.content;
    expect(deployScript).toContain(
      `AgentApiBaseUrl=\${process.env.AGENT_API_BASE_URL ?? env.AGENT_API_BASE_URL ?? '${productionHost}/api/agent'}`,
    );
    expect(deployScript).toContain(
      `SinEnvolturasGuestServiceBaseUrl=\${process.env.SINENVOLTURAS_GUEST_SERVICE_BASE_URL ?? env.SINENVOLTURAS_GUEST_SERVICE_BASE_URL ?? '${productionHost}/api/guest-service'}`,
    );
    expect(deployScript).toContain(
      `SinEnvolturasUserAuthBaseUrl=\${process.env.SINENVOLTURAS_USER_AUTH_BASE_URL ?? env.SINENVOLTURAS_USER_AUTH_BASE_URL ?? '${productionHost}/api-web/user'}`,
    );
    expect(deployScript).toContain(
      `SinEnvolturasBaseUrl=\${process.env.SINENVOLTURAS_BASE_URL ?? env.SINENVOLTURAS_BASE_URL ?? '${productionHost}/api-web/vendor'}`,
    );
  });
});
