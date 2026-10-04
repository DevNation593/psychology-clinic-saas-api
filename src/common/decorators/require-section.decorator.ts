import { SetMetadata } from '@nestjs/common';
import { SectionKey } from '../sections/section-catalog';

export const REQUIRE_SECTION_KEY = 'requireSection';

/** Blocks the route when the platform administrator has not enabled this section for the clinic. */
export const RequireSection = (key: SectionKey) => SetMetadata(REQUIRE_SECTION_KEY, key);
