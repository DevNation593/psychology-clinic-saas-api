const DEFAULT_INACTIVITY_MINUTES = 60;

// How often lastActivityAt is persisted; avoids one DB write per request.
export const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

/**
 * Session inactivity timeout, configurable through SESSION_INACTIVITY_MINUTES.
 */
export function getInactivityTimeoutMs(): number {
  const minutes = Number(process.env.SESSION_INACTIVITY_MINUTES);
  return (minutes > 0 ? minutes : DEFAULT_INACTIVITY_MINUTES) * 60 * 1000;
}
