export async function withRetries<T>(
  attempts: number,
  fn: (attempt: number) => Promise<T>,
  opts?: { label?: string; baseDelayMs?: number },
): Promise<T> {
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      // eslint-disable-next-line no-console
      console.warn(`${opts?.label ?? "withRetries"} failed (attempt ${attempt}/${attempts}):`, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

