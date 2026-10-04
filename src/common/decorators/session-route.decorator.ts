import { SetMetadata } from '@nestjs/common';

export const SESSION_ROUTE_KEY = 'sessionRoute';

/**
 * Routes every authenticated user needs to manage their own session (logout, password change).
 * They stay reachable with a pending password change, an inactive subscription, and for ADMIN.
 */
export const SessionRoute = () => SetMetadata(SESSION_ROUTE_KEY, true);
