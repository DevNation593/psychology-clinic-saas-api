import { SetMetadata } from '@nestjs/common';

export const ALLOW_INACTIVE_SUBSCRIPTION_KEY = 'allowInactiveSubscription';

/** Routes that stay reachable when the subscription is past due or unpaid, so it can be paid. */
export const AllowInactiveSubscription = () => SetMetadata(ALLOW_INACTIVE_SUBSCRIPTION_KEY, true);
