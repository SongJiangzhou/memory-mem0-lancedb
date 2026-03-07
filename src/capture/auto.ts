import * as crypto from 'node:crypto';

import type { AutoCaptureConfig } from '../types';
import { sanitizeMemoryText } from './security';

export type AutoCapturePayload = {
  userId: string;
  runId?: string | null;
  scope: 'long-term' | 'session';
  idempotencyKey: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export function buildAutoCapturePayload(params: {
  userId: string;
  runId?: string | null;
  latestUserMessage: string;
  latestAssistantMessage?: string;
  config: AutoCaptureConfig;
}): AutoCapturePayload | null {
  const rawUserMessage = truncate(params.latestUserMessage || '', params.config.maxCharsPerMessage);
  const rawAssistantMessage = truncate(params.latestAssistantMessage || '', params.config.maxCharsPerMessage);
  
  const { cleanText: userMessage, isRestricted: userRestricted } = sanitizeMemoryText(rawUserMessage);
  const { cleanText: assistantMessage, isRestricted: assistantRestricted } = sanitizeMemoryText(rawAssistantMessage);

  if (!userMessage || userRestricted || assistantRestricted) {
    return null; // Reject capture if restricted content is present
  }

  if (params.config.requireAssistantReply && !assistantMessage) {
    return null;
  }

  const messages: AutoCapturePayload['messages'] = [{ role: 'user', content: userMessage }];
  if (assistantMessage) {
    messages.push({ role: 'assistant', content: assistantMessage });
  }

  const idempotencyKey = crypto
    .createHash('sha256')
    .update([params.userId, params.runId || '', userMessage, assistantMessage].join('|'), 'utf-8')
    .digest('hex');

  return {
    userId: params.userId,
    runId: params.runId || null,
    scope: params.config.scope,
    idempotencyKey,
    messages,
  };
}

function truncate(value: string, maxChars: number): string {
  return String(value || '').slice(0, Math.max(0, maxChars));
}
