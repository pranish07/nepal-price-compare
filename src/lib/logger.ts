export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  readonly requestId: string;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const SECRET_KEYS = /(api[_-]?key|authorization|token|secret|password|cookie)/i;

/** Logs only origin + pathname; query strings can contain user input/secrets. */
export function safeUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function sanitize(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (key === "url" && typeof value === "string") {
      out[key] = safeUrlForLog(value);
      continue;
    }
    if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message };
      continue;
    }
    out[key] = value;
  }
  return out;
}

export interface LoggerOptions {
  silent?: boolean;
  base?: Record<string, unknown>;
}

export function createLogger(requestId: string, options: LoggerOptions = {}): Logger {
  const write = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    if (options.silent) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      requestId,
      ...sanitize(options.base),
      ...sanitize(fields),
    });
    process.stdout.write(`${line}\n`);
  };

  return {
    requestId,
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export function createNoopLogger(requestId = "test"): Logger {
  return createLogger(requestId, { silent: true });
}
