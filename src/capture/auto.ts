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
  const userCandidate = stripHostArtifacts(rawUserMessage);
  const assistantCandidate = stripHostArtifacts(rawAssistantMessage);

  const { isRestricted: userRestricted } = sanitizeMemoryText(userCandidate);
  const { cleanText: assistantMessage, isRestricted: assistantRestricted } = sanitizeMemoryText(assistantCandidate);

  if (!userCandidate || userRestricted || assistantRestricted) {
    return null; // Reject capture if restricted content is present
  }

  if (params.config.requireAssistantReply && !assistantCandidate) {
    return null;
  }

  const messages: AutoCapturePayload['messages'] = [{ role: 'user', content: userCandidate }];
  if (assistantMessage && !shouldDropAssistantMessage(rawAssistantMessage)) {
    messages.push({ role: 'assistant', content: assistantMessage });
  }

  const idempotencyKey = crypto
    .createHash('sha256')
    .update([params.userId, params.runId || '', userCandidate, messages[1]?.content || ''].join('|'), 'utf-8')
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

function stripHostArtifacts(value: string): string {
  return String(value || '')
    .replace(/<recall[^>]*>[\s\S]*?<\/recall>/g, '')
    .replace(/<relevant_memories[^>]*>[\s\S]*?<\/relevant_memories>/g, '')
    .replace(/(?:Sender|Conversation info) \(untrusted metadata\):\n***REMOVED***\n[\s\S]*?***REMOVED***\n?/g, '')
    .replace(/\[\[reply_to_current\]\]\s*/g, '')
    .replace(/^\[[\w\s,:/+-]+\]\s*/gm, '')
    .trim();
}

function shouldDropAssistantMessage(value: string): boolean {
  return /\[\[reply_to_current\]\]/.test(String(value || ''));
}
