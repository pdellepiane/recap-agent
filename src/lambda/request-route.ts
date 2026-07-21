export const runtimeRequestPaths = {
  message: '/',
  overtakeConversation: '/conversations/overtake',
  resumeAutomatedAgent: '/conversations/resume',
} as const;

export type RuntimeRequestRoute =
  | 'message'
  | 'overtake_conversation'
  | 'resume_automated_agent'
  | 'not_found';

export function isRuntimeRequestMethodAllowed(method: string): boolean {
  return method.toUpperCase() === 'POST';
}

export function resolveRuntimeRequestRoute(rawPath: string): RuntimeRequestRoute {
  switch (rawPath) {
    case runtimeRequestPaths.message:
      return 'message';
    case runtimeRequestPaths.overtakeConversation:
      return 'overtake_conversation';
    case runtimeRequestPaths.resumeAutomatedAgent:
      return 'resume_automated_agent';
    default:
      return 'not_found';
  }
}
