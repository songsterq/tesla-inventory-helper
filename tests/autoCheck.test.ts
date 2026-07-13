import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECK_OPTIONS,
  DEFAULT_AUTO_CHECK_HOUR,
  DEFAULT_AUTO_CHECK_MINUTES,
  planAlarm,
} from '../src/autoCheck';

const NINE_AM = 9; // anchor hour used across the scheduling cases

describe('AUTO_CHECK_OPTIONS', () => {
  it('offers Off plus 3h/6h/12h/daily, in minutes', () => {
    expect(AUTO_CHECK_OPTIONS).toEqual([0, 180, 360, 720, 1440]);
  });

  it('defaults to daily at 9AM', () => {
    expect(DEFAULT_AUTO_CHECK_MINUTES).toBe(1440);
    expect(DEFAULT_AUTO_CHECK_HOUR).toBe(9);
  });
});

describe('planAlarm', () => {
  it('clears the alarm when off (0), regardless of anchor/now', () => {
    expect(planAlarm(0, NINE_AM, 0)).toEqual({ clear: true });
  });

  it('clears on non-positive or non-finite input (corrupted storage)', () => {
    expect(planAlarm(-5, NINE_AM, 0)).toEqual({ clear: true });
    expect(planAlarm(NaN, NINE_AM, 0)).toEqual({ clear: true });
    expect(planAlarm(Infinity, NINE_AM, 0)).toEqual({ clear: true });
  });

  it('clamps a below-minimum positive value up to the 3h floor', () => {
    // Shouldn't happen via the UI, but a corrupted sync value must never produce
    // a sub-3h alarm. now == anchor → a full clamped period.
    expect(planAlarm(60, NINE_AM, NINE_AM * 60)).toEqual({
      periodInMinutes: 180,
      delayInMinutes: 180,
    });
  });

  it('floors fractional minutes', () => {
    // now == anchor → delay is a full (floored) period.
    expect(planAlarm(360.7, NINE_AM, NINE_AM * 60)).toEqual({
      periodInMinutes: 360,
      delayInMinutes: 360,
    });
  });

  it('waits a full period when now is exactly on the anchor (no immediate fire)', () => {
    expect(planAlarm(1440, NINE_AM, 9 * 60)).toEqual({
      periodInMinutes: 1440,
      delayInMinutes: 1440,
    });
    expect(planAlarm(180, NINE_AM, 9 * 60)).toEqual({
      periodInMinutes: 180,
      delayInMinutes: 180,
    });
  });

  it('delays until the next daily anchor when the anchor is later today', () => {
    // 8:00 now, anchor 9AM daily → fires in 60 minutes.
    expect(planAlarm(1440, NINE_AM, 8 * 60)).toEqual({
      periodInMinutes: 1440,
      delayInMinutes: 60,
    });
  });

  it('rolls over to tomorrow when the daily anchor has just passed', () => {
    // 9:01 now, anchor 9AM daily → next fire is nearly a full day away.
    expect(planAlarm(1440, NINE_AM, 9 * 60 + 1)).toEqual({
      periodInMinutes: 1440,
      delayInMinutes: 1440 - 1,
    });
  });

  it('anchors the phase of a sub-daily interval', () => {
    // Every 6h anchored at 9AM fires at 9,15,21,3. At 10:00 the next fire is 15:00.
    expect(planAlarm(360, NINE_AM, 10 * 60)).toEqual({
      periodInMinutes: 360,
      delayInMinutes: 5 * 60,
    });
    // At 16:00 the next 6h slot (anchored at 9) is 21:00 → 5h away.
    expect(planAlarm(360, NINE_AM, 16 * 60)).toEqual({
      periodInMinutes: 360,
      delayInMinutes: 5 * 60,
    });
  });

  it('handles a sub-daily slot that wraps past midnight', () => {
    // Every 6h anchored at 9AM: slots 9,15,21,3. At 23:00 the next slot is 3:00
    // next day → 4h away.
    expect(planAlarm(360, NINE_AM, 23 * 60)).toEqual({
      periodInMinutes: 360,
      delayInMinutes: 4 * 60,
    });
  });

  it('clamps a corrupted anchor hour into 0..23', () => {
    // Out-of-range anchors must never blow up the delay math; treat as 0 (midnight).
    // now == midnight, anchor coerced to 0 → full period.
    expect(planAlarm(1440, 99, 0)).toEqual({ periodInMinutes: 1440, delayInMinutes: 1440 });
    expect(planAlarm(1440, -3, 0)).toEqual({ periodInMinutes: 1440, delayInMinutes: 1440 });
    expect(planAlarm(1440, NaN, 0)).toEqual({ periodInMinutes: 1440, delayInMinutes: 1440 });
  });
});
