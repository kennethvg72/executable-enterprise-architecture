// JSON logs, one object per line, to standard output (OBS-01).
// Never log secrets, session tokens or taxpayer-restricted data: refer to records by reference.

export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

export function createLogger(service: string, write: (line: string) => void = (l) => process.stdout.write(l + '\n'), base: Fields = {}): Logger {
  const emit = (level: Level) => (msg: string, fields: Fields = {}) => {
    const entry: Fields = { time: new Date().toISOString(), level, msg, service, ...base, ...fields };
    if (entry.err instanceof Error) entry.err = { name: entry.err.name, message: entry.err.message };
    write(JSON.stringify(entry));
  };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (fields) => createLogger(service, write, { ...base, ...fields }),
  };
}
