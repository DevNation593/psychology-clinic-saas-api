import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ClinicalProfileGuard } from './clinical-profile.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalNotesController } from '../clinical-notes/clinical-notes.controller';
import { ClinicalTimelineController } from '../clinical-timeline/clinical-timeline.controller';
import { SpecialtyRecordsController } from '../specialty-records/specialty-records.controller';

describe('ClinicalProfileGuard', () => {
  const prisma = { professionalProfile: { findFirst: jest.fn() } };
  const guard = new ClinicalProfileGuard(prisma as unknown as PrismaService);
  const context = (request: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
  const request = (role: string) => ({
    user: { userId: 'user-1', tenantId: 'tenant-1', role },
    ip: '10.0.0.1',
    headers: { 'user-agent': 'jest' },
    clinicalActor: undefined,
  });

  beforeEach(() => jest.resetAllMocks());

  it('looks for an active profile of an active user inside the caller tenant only', async () => {
    prisma.professionalProfile.findFirst.mockResolvedValue({ specialtyId: 'psychology' });

    await guard.canActivate(context(request('PROFESIONAL')));

    expect(prisma.professionalProfile.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        isActive: true,
        user: { tenantId: 'tenant-1', isActive: true },
      },
      select: { specialtyId: true },
    });
  });

  it('exposes the actor with its specialty and request origin', async () => {
    prisma.professionalProfile.findFirst.mockResolvedValue({ specialtyId: 'psychology' });
    const req = request('MASTER');

    await expect(guard.canActivate(context(req))).resolves.toBe(true);

    expect(req.clinicalActor).toEqual({
      userId: 'user-1',
      role: 'MASTER',
      specialtyId: 'psychology',
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
    });
  });

  // No profile, an inactive profile and a profile in another tenant all resolve to "not found".
  it.each(['MASTER', 'PROFESIONAL', 'ASISTENTE', 'SOPORTE'])(
    'rejects a %s without an active professional profile',
    async (role) => {
      prisma.professionalProfile.findFirst.mockResolvedValue(null);
      const req = request(role);

      await expect(guard.canActivate(context(req))).rejects.toMatchObject({
        status: 403,
        response: { code: 'PROFESSIONAL_NOT_AUTHORIZED' },
      });
      expect(req.clinicalActor).toBeUndefined();
    },
  );

  it('rejects a request without an authenticated user and does not query', async () => {
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.professionalProfile.findFirst).not.toHaveBeenCalled();
  });

  it.each([ClinicalNotesController, SpecialtyRecordsController, ClinicalTimelineController])(
    'protects every handler of %p',
    (controller) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([ClinicalProfileGuard]);
    },
  );
});
