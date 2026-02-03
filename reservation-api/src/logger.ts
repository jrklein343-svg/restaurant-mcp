/**
 * Verbose logging utility for debugging API calls
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL = LogLevel.DEBUG; // Show all logs

interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  data?: unknown;
}

const logHistory: LogEntry[] = [];
const MAX_HISTORY = 500;

function formatTimestamp(): string {
  return new Date().toISOString();
}

function addToHistory(entry: LogEntry): void {
  logHistory.push(entry);
  if (logHistory.length > MAX_HISTORY) {
    logHistory.shift();
  }
}

export function debug(component: string, message: string, data?: unknown): void {
  if (LOG_LEVEL <= LogLevel.DEBUG) {
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level: 'DEBUG',
      component,
      message,
      data,
    };
    addToHistory(entry);
    console.log(`[${entry.timestamp}] [DEBUG] [${component}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

export function info(component: string, message: string, data?: unknown): void {
  if (LOG_LEVEL <= LogLevel.INFO) {
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level: 'INFO',
      component,
      message,
      data,
    };
    addToHistory(entry);
    console.log(`[${entry.timestamp}] [INFO] [${component}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

export function warn(component: string, message: string, data?: unknown): void {
  if (LOG_LEVEL <= LogLevel.WARN) {
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level: 'WARN',
      component,
      message,
      data,
    };
    addToHistory(entry);
    console.warn(`[${entry.timestamp}] [WARN] [${component}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

export function error(component: string, message: string, data?: unknown): void {
  if (LOG_LEVEL <= LogLevel.ERROR) {
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level: 'ERROR',
      component,
      message,
      data,
    };
    addToHistory(entry);
    console.error(`[${entry.timestamp}] [ERROR] [${component}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

export function logRequest(component: string, method: string, url: string, params?: unknown, headers?: Record<string, string>): void {
  debug(component, `>>> REQUEST: ${method} ${url}`, {
    params,
    headers: headers ? Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, k.toLowerCase().includes('auth') ? '***REDACTED***' : v])
    ) : undefined,
  });
}

export function logResponse(component: string, status: number, url: string, data?: unknown, timing?: number): void {
  const level = status >= 400 ? 'ERROR' : 'DEBUG';
  const truncatedData = data ? truncateData(data) : undefined;

  if (level === 'ERROR') {
    error(component, `<<< RESPONSE: ${status} ${url} (${timing}ms)`, truncatedData);
  } else {
    debug(component, `<<< RESPONSE: ${status} ${url} (${timing}ms)`, truncatedData);
  }
}

function truncateData(data: unknown, maxLength = 2000): unknown {
  const str = JSON.stringify(data);
  if (str.length <= maxLength) return data;
  return { _truncated: true, preview: str.substring(0, maxLength) + '...' };
}

export function getLogHistory(): LogEntry[] {
  return [...logHistory];
}

export function clearLogHistory(): void {
  logHistory.length = 0;
}

export function getRecentLogs(count = 50): LogEntry[] {
  return logHistory.slice(-count);
}

export const logger = {
  debug,
  info,
  warn,
  error,
  logRequest,
  logResponse,
  getLogHistory,
  clearLogHistory,
  getRecentLogs,
};
