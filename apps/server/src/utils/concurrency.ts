export function createConcurrencyLimiter(maxConcurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) {
    throw new Error(`maxConcurrency must be a positive integer, got: ${maxConcurrency}`);
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    activeCount -= 1;
    const run = queue.shift();
    if (run) run();
  };

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (activeCount >= maxConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    activeCount += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

