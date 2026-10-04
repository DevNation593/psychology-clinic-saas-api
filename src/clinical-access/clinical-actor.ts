import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The authenticated professional behind a clinical request, as resolved by ClinicalProfileGuard. */
export interface ClinicalActor {
  userId: string;
  role: string;
  specialtyId: string;
  ipAddress?: string;
  userAgent?: string;
}

export const CurrentClinicalActor = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ClinicalActor => {
    const request = ctx.switchToHttp().getRequest();
    return request.clinicalActor;
  },
);
