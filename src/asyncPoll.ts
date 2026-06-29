// Poll `fn` until it returns a non-null result or the overall timeout elapses.
// Used by the background worker to retry a content-script scrape while a Tesla
// SPA page is still rendering. Timers are injectable so it is unit-testable.

export type PollOptions = {
  intervalMs: number;
  timeoutMs: number;
  setTimeoutFn?: typeof setTimeout;
  now?: () => number;
};

const realNow = () => Date.now();

export async function pollWithTimeout<T>(
  fn: () => Promise<T | null> | T | null,
  options: PollOptions,
): Promise<T | null> {
  const { intervalMs, timeoutMs } = options;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const now = options.now ?? realNow;
  const deadline = now() + timeoutMs;

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeoutFn(() => resolve(), ms));

  // Try immediately, then on each interval until the deadline passes.
  for (;;) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch {
      // Swallow transient failures (e.g. message port not ready) and retry.
    }
    if (now() >= deadline) return null;
    await wait(intervalMs);
    if (now() >= deadline) return null;
  }
}
