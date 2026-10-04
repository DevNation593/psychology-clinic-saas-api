import { ForbiddenException, NotFoundException } from '@nestjs/common';

export const clinicalRecordNotFound = (message: string) =>
  new NotFoundException({ statusCode: 404, code: 'CLINICAL_RECORD_NOT_FOUND', message });

export const clinicalRecordForbidden = (message: string) =>
  new ForbiddenException({ statusCode: 403, code: 'CLINICAL_RECORD_FORBIDDEN', message });
