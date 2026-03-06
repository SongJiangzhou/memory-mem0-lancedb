import * as crypto from 'node:crypto';

export function normalizeText(text: string): string {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildMemoryUid(
  userId: string,
  scope: string,
  text: string,
  tsBucket: string,
  category = 'general',
): string {
  const raw = [
    userId.trim(),
    scope.trim(),
    normalizeText(text),
    tsBucket.trim(),
    category.trim(),
  ].join('|');

  return crypto.createHash('sha256').update(raw, 'utf-8').digest('hex');
}
