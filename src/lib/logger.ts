type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = [
  "token",
  "secret",
  "password",
  "cookie",
  "authorization",
  "private",
  "x-hub-signature",
  "access_token",
  "key",
];

function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    if (obj.length > 400) return `${obj.slice(0, 400)}…`;
    return obj;
  }
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map((x) => sanitize(x, depth + 1));
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitive(k)) out[k] = "[REDACTED]";
      else out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return obj;
}

/** Structured logger. All output is JSON on stdout so it can be shipped to any aggregator. */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(sanitize(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),
};