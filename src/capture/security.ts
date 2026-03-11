export function sanitizeMemoryText(text: string): { cleanText: string; isRestricted: boolean } {
  const restrictedPatterns = [
    /ignore all previous instructions/i,
    /system prompt/i,
    /api[-\s_]?key/i,
    /password/i,
    /secret/i
  ];
  
  let isRestricted = false;
  for (const p of restrictedPatterns) {
    if (p.test(text)) {
      isRestricted = true;
      break;
    }
  }

  let cleanText = String(text || '');
  cleanText = cleanText
    .replace(/ignore all previous instructions/ig, '[REDACTED_INSTRUCTION]')
    .replace(/system prompt/ig, '[REDACTED_SYSTEM_PROMPT]')
    .replace(/(api[-\s_]?key\s*(?:is|=|:)?\s*)([^\s,;]+)/ig, '$1[REDACTED]')
    .replace(/(password\s*(?:is|=|:)?\s*)([^\s,;]+)/ig, '$1[REDACTED]')
    .replace(/(secret\s*(?:is|=|:)?\s*)([^\s,;]+)/ig, '$1[REDACTED]');

  return { cleanText, isRestricted };
}
