import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ROUTE_KEY = 'platformRoute';

/** Routes of the platform control panel: reachable only by an ADMIN of the platform tenant. */
export const PlatformRoute = () => SetMetadata(PLATFORM_ROUTE_KEY, true);
