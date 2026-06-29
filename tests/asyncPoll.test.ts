import { describe, expect, it, vi } from 'vitest';
import { pollWithTimeout } from '../src/asyncPoll';

// Deterministic fakes: a clock we advance manually and a setTimeout that runs
// the callback immediately while advancing the clock by the requested delay.
function harness() {
  let clock = 0;
  const now = () => clock;
  const setTimeoutFn = ((cb: () => void, ms?: number) => {
    clock += ms ?? 0;
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  return { now, setTimeoutFn };
}

describe('pollWithTimeout', () => {
  it('resolves immediately when the first attempt is ready', async () => {
    const { now, setTimeoutFn } = harness();
    const fn = vi.fn(async () => 'ready');
    const result = await pollWithTimeout(fn, { intervalMs: 750, timeoutMs: 20000, now, setTimeoutFn });
    expect(result).toBe('ready');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until a later attempt is ready', async () => {
    const { now, setTimeoutFn } = harness();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls >= 3 ? 'ready' : null;
    };
    const result = await pollWithTimeout(fn, { intervalMs: 750, timeoutMs: 20000, now, setTimeoutFn });
    expect(result).toBe('ready');
    expect(calls).toBe(3);
  });

  it('returns null when it never becomes ready before the timeout', async () => {
    const { now, setTimeoutFn } = harness();
    const fn = vi.fn(async () => null);
    const result = await pollWithTimeout(fn, { intervalMs: 750, timeoutMs: 3000, now, setTimeoutFn });
    expect(result).toBeNull();
    // ~3000 / 750 attempts; exact count not asserted, just that it stopped.
    expect(fn.mock.calls.length).toBeGreaterThan(1);
  });

  it('swallows thrown errors and keeps polling', async () => {
    const { now, setTimeoutFn } = harness();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 2) throw new Error('port closed');
      return 'ready';
    };
    const result = await pollWithTimeout(fn, { intervalMs: 750, timeoutMs: 20000, now, setTimeoutFn });
    expect(result).toBe('ready');
    expect(calls).toBe(2);
  });
});
