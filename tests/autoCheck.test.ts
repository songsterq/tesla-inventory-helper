import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECK_OPTIONS,
  DEFAULT_AUTO_CHECK_MINUTES,
  planAlarm,
} from '../src/autoCheck';

describe('AUTO_CHECK_OPTIONS', () => {
  it('offers Off plus 3h/6h/12h/daily, in minutes', () => {
    expect(AUTO_CHECK_OPTIONS).toEqual([0, 180, 360, 720, 1440]);
  });

  it('defaults to daily', () => {
    expect(DEFAULT_AUTO_CHECK_MINUTES).toBe(1440);
  });
});

describe('planAlarm', () => {
  it('clears the alarm when off (0)', () => {
    expect(planAlarm(0)).toEqual({ clear: true });
  });

  it('schedules a repeating alarm delayed by its own period so it does not fire immediately', () => {
    expect(planAlarm(1440)).toEqual({ periodInMinutes: 1440, delayInMinutes: 1440 });
    expect(planAlarm(180)).toEqual({ periodInMinutes: 180, delayInMinutes: 180 });
  });

  it('clears on non-positive or non-finite input (corrupted storage)', () => {
    expect(planAlarm(-5)).toEqual({ clear: true });
    expect(planAlarm(NaN)).toEqual({ clear: true });
    expect(planAlarm(Infinity)).toEqual({ clear: true });
  });

  it('clamps a below-minimum positive value up to the 3h floor', () => {
    // Shouldn't happen via the UI, but a corrupted sync value must never produce
    // a sub-3h alarm.
    expect(planAlarm(60)).toEqual({ periodInMinutes: 180, delayInMinutes: 180 });
  });

  it('floors fractional minutes', () => {
    expect(planAlarm(360.7)).toEqual({ periodInMinutes: 360, delayInMinutes: 360 });
  });
});
