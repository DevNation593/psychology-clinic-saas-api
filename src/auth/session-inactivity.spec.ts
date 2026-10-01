import { getActivityWriteIntervalMs, getInactivityTimeoutMs } from './session-inactivity';

describe('session inactivity settings', () => {
  const original = process.env.SESSION_INACTIVITY_MINUTES;

  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_INACTIVITY_MINUTES;
    else process.env.SESSION_INACTIVITY_MINUTES = original;
  });

  it('defaults to 60 minutes and persists activity at most once a minute', () => {
    delete process.env.SESSION_INACTIVITY_MINUTES;
    expect(getInactivityTimeoutMs()).toBe(60 * 60 * 1000);
    expect(getActivityWriteIntervalMs()).toBe(60 * 1000);
  });

  it('keeps the write interval below a short timeout', () => {
    process.env.SESSION_INACTIVITY_MINUTES = '0.5';
    expect(getInactivityTimeoutMs()).toBe(30 * 1000);
    expect(getActivityWriteIntervalMs()).toBe(15 * 1000);
  });

  it('ignores invalid values', () => {
    process.env.SESSION_INACTIVITY_MINUTES = 'abc';
    expect(getInactivityTimeoutMs()).toBe(60 * 60 * 1000);
  });
});
