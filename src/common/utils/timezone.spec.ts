import { getZonedDateParts } from './timezone';

describe('getZonedDateParts', () => {
  // Friday 2026-10-02 14:30 UTC
  const instant = new Date('2026-10-02T14:30:00.000Z');

  it('reads the weekday and time in the requested time zone', () => {
    expect(getZonedDateParts(instant, 'America/Guayaquil')).toEqual({
      dayOfWeek: 'FRIDAY',
      minutesOfDay: 9 * 60 + 30,
    });
    expect(getZonedDateParts(instant, 'UTC')).toEqual({
      dayOfWeek: 'FRIDAY',
      minutesOfDay: 14 * 60 + 30,
    });
  });

  it('accounts for the day changing across time zones', () => {
    const lateUtc = new Date('2026-10-03T02:00:00.000Z');
    expect(getZonedDateParts(lateUtc, 'America/Guayaquil')).toEqual({
      dayOfWeek: 'FRIDAY',
      minutesOfDay: 21 * 60,
    });
  });

  it('reports midnight as minute zero', () => {
    expect(getZonedDateParts(new Date('2026-10-02T00:00:00.000Z'), 'UTC').minutesOfDay).toBe(0);
  });

  it('falls back to the server time zone for an invalid zone', () => {
    expect(getZonedDateParts(instant, 'Not/AZone')).toEqual(getZonedDateParts(instant));
  });
});
