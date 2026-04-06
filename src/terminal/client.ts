import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { getConfig } from '../runtime/config';

const config = getConfig();

async function main() {
  if (!config.lambdaFunctionUrl) {
    throw new Error(
      'AGENT_FUNCTION_URL is required for the terminal client to hit the live Lambda.',
    );
  }

  const rl = readline.createInterface({ input, output });
  const userId = process.env.TERMINAL_USER_ID ?? '51999999999';

  output.write(
    `Connected to ${config.lambdaFunctionUrl}\nUsing terminal user ${userId}\nType /exit to leave.\n\n`,
  );

  while (true) {
    const text = (await rl.question('you> ')).trim();
    if (!text) {
      continue;
    }

    if (text === '/exit') {
      break;
    }

    const response = await fetch(config.lambdaFunctionUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        channel: 'terminal_whatsapp',
        user_id: userId,
        text,
      }),
    });

    const payload = (await response.json()) as {
      message?: string;
      current_node?: string;
      trace?: Record<string, unknown>;
      error?: string;
    };

    if (!response.ok) {
      output.write(`error> ${payload.error ?? 'Unknown error'}\n\n`);
      continue;
    }

    output.write(`agent> ${payload.message ?? ''}\n`);
    output.write(`node> ${payload.current_node ?? 'unknown'}\n`);
    output.write(`trace> ${JSON.stringify(payload.trace, null, 2)}\n\n`);
  }

  rl.close();
}

void main();

