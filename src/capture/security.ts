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
  
  return { cleanText: text, isRestricted };
}