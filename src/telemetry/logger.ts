type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

function emit(level: LogLevel, component: string, event: string, payload: LogPayload = {}): void {
  const sanitized = sanitize(payload);
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    event,
    ...(isPlainObject(sanitized) ? sanitized : { payload: sanitized }),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (component: string, event: string, payload?: LogPayload) => emit('debug', component, event, payload),
  info: (component: string, event: string, payload?: LogPayload) => emit('info', component, event, payload),
  warn: (component: string, event: string, payload?: LogPayload) => emit('warn', component, event, payload),
  error: (component: string, event: string, payload?: LogPayload) => emit('error', component, event, payload),
};

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|api[_-]?key|authorization/i.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    if (typeof raw === 'string' && raw.length > 1200) {
      output[key] = `${raw.slice(0, 1200)}…`;
      continue;
    }
    output[key] = sanitize(raw);
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
