export const SHARED_MEMORY_USER_ID = 'default';

export function resolveSharedUserId(_requestedUserId?: string | null): string {
  return SHARED_MEMORY_USER_ID;
}

export function normalizeSessionId(sessionId?: string | null): string {
  return String(sessionId || '').trim();
}

export function normalizeAgentId(agentId?: string | null): string {
  return String(agentId || '').trim();
}

export function getScopedMemoryIdentity(params: {
  scope: 'long-term' | 'session';
  userId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
}): { userId: string; sessionId: string; agentId: string } {
  const userId = resolveSharedUserId(params.userId);
  if (params.scope === 'session') {
    return {
      userId,
      sessionId: normalizeSessionId(params.sessionId),
      agentId: normalizeAgentId(params.agentId),
    };
  }

  return {
    userId,
    sessionId: '',
    agentId: '',
  };
}
