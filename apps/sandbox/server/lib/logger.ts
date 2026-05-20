type LogMeta = Record<string, unknown> | undefined;

function write(level: "info" | "warn" | "error", message: string, meta?: LogMeta): void {
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg: message };
  if (meta) Object.assign(entry, meta);
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    write("info", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    write("warn", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    write("error", message, meta);
  },
};
