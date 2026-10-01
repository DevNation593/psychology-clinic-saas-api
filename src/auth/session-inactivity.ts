const DEFAULT_INACTIVITY_MINUTES = 60;
const MAX_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

/**
 * Session inactivity timeout, configurable through SESSION_INACTIVITY_MINUTES.
 */
export function getInactivityTimeoutMs(): number {
  const minutes = Number(process.env.SESSION_INACTIVITY_MINUTES);
  return (minutes > 0 ? minutes : DEFAULT_INACTIVITY_MINUTES) * 60 * 1000;
}

/**
 * How often lastActivityAt is persisted; avoids one DB write per request.
 * Always well below the timeout so an active user is never seen as idle.
 */
export function getActivityWriteIntervalMs(): number {
  return Math.min(MAX_ACTIVITY_WRITE_INTERVAL_MS, getInactivityTimeoutMs() / 2);
}
