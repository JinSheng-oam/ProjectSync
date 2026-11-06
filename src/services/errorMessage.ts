export function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof Error && error.message && error.message !== '[object Object]') {
    return error.message;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    if (!message || message === '[object Object]') return fallback;
    if (message.startsWith('{')) {
      try {
        return getErrorMessage(JSON.parse(message), fallback);
      } catch {
        // Keep the original text when it is not JSON.
      }
    }
    return message;
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'reason', 'cause']) {
      if (value[key] === error || value[key] === '[object Object]') continue;
      const message = getErrorMessage(value[key], '');
      if (message) {
        const code = typeof value.code === 'string' ? `（${value.code}）` : '';
        return `${message}${code}`;
      }
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the caller-provided fallback.
    }
  }
  return fallback;
}
