import { appendFileSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { DebugConfig } from '../types';

export interface PluginLoggerSink {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

const TEXT_PREVIEW_LIMIT = 200;
const REDACTED = '[redacted]';

export class PluginDebugLogger {
  private readonly config: DebugConfig;
  private readonly sink?: PluginLoggerSink;

  constructor(config?: DebugConfig, sink?: PluginLoggerSink) {
    this.config = config || { mode: 'off' };
    this.sink = sink;
  }

  basic(event: string, fields?: Record<string, unknown>): void {
    if (this.config.mode === 'off') {
      return;
    }

    this.emit('info', event, fields);
  }

  verbose(event: string, fields?: Record<string, unknown>): void {
    if (this.config.mode !== 'verbose') {
      return;
    }

    this.emit('info', event, fields);
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.emit('warn', event, fields);
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.emit('error', event, fields);
  }

  private emit(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void {
    const payload = {
      ts: new Date().toISOString(),
      level,
      event,
      fields: sanitizeFields(fields || {}),
    };
    const line = JSON.stringify(payload);

    try {
      const logFn = this.sink?.[level] || console[level];
      logFn?.(line);
    } catch {
      // Never let debug logging break the caller.
    }

    if (this.config.logDir) {
      this.writeLine(line);
    }
  }

  private writeLine(line: string): void {
    try {
      const resolvedDir = resolvePath(this.config.logDir || '');
      mkdirSync(resolvedDir, { recursive: true });
      const logPath = path.join(resolvedDir, `${new Date().toISOString().slice(0, 10)}.log`);
      appendFileSync(logPath, `${line}\n`, 'utf-8');
    } catch {
      // Never let file logging break the caller.
    }
  }
}

export function summarizeText(value: unknown, maxChars: number = TEXT_PREVIEW_LIMIT): Record<string, unknown> {
  const text = String(value || '');
  return {
    text_preview: text.length > maxChars ? `${text.slice(0, maxChars)}...` : text,
    text_length: text.length,
  };
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (/api.?key/i.test(key)) {
      sanitized[key] = REDACTED;
      continue;
    }

    if (typeof value === 'string' && value.length > TEXT_PREVIEW_LIMIT) {
      sanitized.text_preview = `${value.slice(0, TEXT_PREVIEW_LIMIT)}...`;
      sanitized[`${key}_length`] = value.length;
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function resolvePath(targetPath: string): string {
  if (targetPath.startsWith('~/')) {
    return path.join(os.homedir(), targetPath.slice(2));
  }

  return targetPath;
}
