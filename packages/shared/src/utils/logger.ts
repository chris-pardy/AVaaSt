export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(
  level: LogLevel,
  component: string,
  message: string
): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level.toUpperCase()}] [${component}] ${message}`;
}

export function createLogger(component: string) {
  return {
    debug(message: string, data?: unknown) {
      if (shouldLog("debug")) {
        console.debug(formatMessage("debug", component, message), data ?? "");
      }
    },
    info(message: string, data?: unknown) {
      if (shouldLog("info")) {
        console.info(formatMessage("info", component, message), data ?? "");
      }
    },
    warn(message: string, data?: unknown) {
      if (shouldLog("warn")) {
        console.warn(formatMessage("warn", component, message), data ?? "");
      }
    },
    error(message: string, data?: unknown) {
      if (shouldLog("error")) {
        console.error(formatMessage("error", component, message), data ?? "");
      }
    },
  };
}
