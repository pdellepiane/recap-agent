/**
 * WP2 — Decisions API router: the three fixed questions.
 *
 * The question set is three choices and nothing else. The router no longer
 * scores how stuck the conversation looks: it says which route the turn needs,
 * whether the turn is about the request the runtime already has open, and
 * whether that turn leaves the request settled.
 *
 * This module owns the SHAPE (names, values, order); the instruction text and
 * the option descriptions live in git-tracked prompt files under
 * `prompts/router/` and are supplied by the PromptLoader.
 *
 * Nothing here is a conversational reply: the router decides, the reply model
 * writes. The instructions never name a reply, a promise or a wording.
 */
import type { OpenRequest } from '../core/open-request';
import type { PromptLoader } from './prompt-loader';

/** The seven routes fixed by Decision 1. Order is the contract order. */
export const routerRouteValues = [
  'answer_with_records',
  'information_flow',
  'ask_clarification',
  'offer_human',
  'escalate_human',
  'rsvp_flow',
  'planning_flow',
  'suppress_ack',
] as const;

export type RouterRoute = (typeof routerRouteValues)[number];

export function isRouterRoute(value: string): value is RouterRoute {
  return (routerRouteValues as readonly string[]).includes(value);
}

/** Values of `same_open_request`, in contract order. */
export const routerSameOpenRequestValues = ['same', 'new'] as const;

export type RouterSameOpenRequestAnswer =
  (typeof routerSameOpenRequestValues)[number];

/** Values of `request_settled`, in contract order. */
export const routerRequestSettledValues = ['settled', 'open'] as const;

export type RouterRequestSettledAnswer =
  (typeof routerRequestSettledValues)[number];

export type RouterChoiceQuestion = {
  readonly type: 'choice';
  readonly name: 'route' | 'same_open_request' | 'request_settled';
  readonly instructions: string;
  readonly choices: readonly {
    readonly value: string;
    readonly description: string;
  }[];
};

export type RouterQuestion = RouterChoiceQuestion;

export type RouterQuestionName = RouterChoiceQuestion['name'];

export type RouterQuestions = {
  readonly questions: readonly RouterQuestion[];
  readonly promptBundleId: string;
  readonly promptFilePaths: readonly string[];
};

/** Prompt files backing the three questions. Tracked under `prompts/router/`. */
export const routerQuestionPromptFiles = {
  route: 'router/route.txt',
  sameOpenRequest: 'router/same_open_request.txt',
  requestSettled: 'router/request_settled.txt',
} as const;

const CHOICES_SECTION_MARKER = '--- choices ---';

/**
 * Load the three questions with their prompt-backed instructions.
 *
 * The loader validates the prompt files against the fixed shape: seven route
 * choices in contract order, two values for each of the two facts, and
 * distinct descriptions. A prompt file that drifts from the contract fails
 * closed instead of silently changing the router.
 */
export async function loadRouterQuestions(loader: PromptLoader): Promise<RouterQuestions> {
  const paths = [
    routerQuestionPromptFiles.route,
    routerQuestionPromptFiles.sameOpenRequest,
    routerQuestionPromptFiles.requestSettled,
  ];
  const loaded = await Promise.all(
    paths.map(async (relativePath) => ({
      relativePath,
      content: await loadRouterPromptFile(loader, relativePath),
    })),
  );
  const byPath = new Map(loaded.map((entry) => [entry.relativePath, entry.content]));

  const routeFile = splitRouterPrompt(
    byPath.get(routerQuestionPromptFiles.route) ?? '',
    routerQuestionPromptFiles.route,
  );
  const sameOpenRequestFile = splitRouterPrompt(
    byPath.get(routerQuestionPromptFiles.sameOpenRequest) ?? '',
    routerQuestionPromptFiles.sameOpenRequest,
  );
  const requestSettledFile = splitRouterPrompt(
    byPath.get(routerQuestionPromptFiles.requestSettled) ?? '',
    routerQuestionPromptFiles.requestSettled,
  );

  const questions: readonly RouterQuestion[] = [
    {
      type: 'choice',
      name: 'route',
      instructions: routeFile.instruction,
      choices: requireValues(
        routeFile.entries,
        routerRouteValues,
        routerQuestionPromptFiles.route,
      ),
    },
    {
      type: 'choice',
      name: 'same_open_request',
      instructions: sameOpenRequestFile.instruction,
      choices: requireValues(
        sameOpenRequestFile.entries,
        routerSameOpenRequestValues,
        routerQuestionPromptFiles.sameOpenRequest,
      ),
    },
    {
      type: 'choice',
      name: 'request_settled',
      instructions: requestSettledFile.instruction,
      choices: requireValues(
        requestSettledFile.entries,
        routerRequestSettledValues,
        routerQuestionPromptFiles.requestSettled,
      ),
    },
  ];

  return {
    questions,
    promptBundleId: loaded.map((entry) => entry.relativePath).join(','),
    promptFilePaths: paths,
  };
}

/**
 * Read one tracked prompt file through the loader. `loadModuleFilesBundle`
 * prefixes each file with its display path; the prefix is stripped so the
 * caller receives the file body.
 */
async function loadRouterPromptFile(
  loader: PromptLoader,
  relativePath: string,
): Promise<string> {
  const bundle = await loader.loadModuleFilesBundle([relativePath], []);
  const header = `## ${relativePath}\n`;
  return bundle.instructions.startsWith(header)
    ? bundle.instructions.slice(header.length).trim()
    : bundle.instructions.trim();
}

function splitRouterPrompt(
  content: string,
  relativePath: string,
): { instruction: string; entries: string[] } {
  const lines = content.split(/\r?\n/u);
  const markerIndex = lines.findIndex((line) => line.trim() === CHOICES_SECTION_MARKER);
  if (markerIndex < 0) {
    throw new Error(`Router prompt file is missing the section marker "${CHOICES_SECTION_MARKER}": ${relativePath}`);
  }
  const instruction = lines.slice(0, markerIndex).join('\n').trim();
  if (instruction.length === 0) {
    throw new Error(`Router prompt file has no instruction text: ${relativePath}`);
  }
  const entries = lines
    .slice(markerIndex + 1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return { instruction, entries };
}

/**
 * Check the entries against the contract values, in order, with distinct
 * descriptions. A drifting prompt fails closed.
 */
function requireValues(
  entries: readonly string[],
  expected: readonly string[],
  relativePath: string,
): readonly { value: string; description: string }[] {
  if (entries.length !== expected.length) {
    throw new Error(
      `Router prompt must define exactly ${expected.length} choices, found ${entries.length}: ${relativePath}`,
    );
  }
  const choices = entries.map((entry, index) => {
    const { value, description } = parseEntry(entry, relativePath);
    if (value !== expected[index]) {
      throw new Error(
        `Router prompt must list "${expected[index]}" at position ${index}, found "${value}": ${relativePath}`,
      );
    }
    return { value, description };
  });
  const descriptions = new Set(choices.map((choice) => choice.description));
  if (descriptions.size !== choices.length) {
    throw new Error('Router prompt must give every choice a distinct description.');
  }
  return choices;
}

function parseEntry(entry: string, relativePath: string): { value: string; description: string } {
  const separatorIndex = entry.indexOf('|');
  if (separatorIndex < 0) {
    throw new Error(`Router prompt entry must be "value | description": ${relativePath}`);
  }
  const value = entry.slice(0, separatorIndex).trim();
  const description = entry.slice(separatorIndex + 1).trim();
  if (value.length === 0 || description.length === 0) {
    throw new Error(`Router prompt entry must have a value and a description: ${relativePath}`);
  }
  return { value, description };
}

/**
 * Bind the reference choices to the exact retained, validated request identities.
 *
 * The GA Decisions API requires every choice question to carry at least two
 * options. With no retained request there is nothing to compare against, so
 * the question is omitted and the client reads the absent answer as `new`.
 */
export function bindRouterRequestChoices(
  questions: readonly RouterQuestion[], requests: readonly OpenRequest[],
): readonly RouterQuestion[] {
  if (requests.length === 0) {
    return questions.filter((question) => question.name !== 'same_open_request');
  }
  return questions.map((question) => question.name !== 'same_open_request' ? question : ({
    ...question,
    choices: [
      ...requests.map((request) => ({ value: `request:${request.key}`, description: question.choices[0].description })),
      { value: 'new', description: question.choices[1].description },
    ],
  }));
}
