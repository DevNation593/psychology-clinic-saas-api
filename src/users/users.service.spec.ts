import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ProfessionalProfilesService } from '../professional-profiles/professional-profiles.service';
import { UsersService } from './users.service';

describe('UsersService self profile updates', () => {
  const db = {
    $transaction: jest.fn(),
    applyRlsContext: jest.fn(),
    user: { findFirst: jest.fn(), update: jest.fn() },
    professionalProfile: { update: jest.fn() },
  };
  let service: UsersService;

  const updateSelf = (tenantId: string, userId: string, dto: unknown) =>
    (
      service as unknown as {
        updateSelf: (tenantId: string, userId: string, dto: unknown) => Promise<any>;
      }
    ).updateSelf(tenantId, userId, dto);

  beforeEach(() => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(db),
    );
    service = new UsersService(
      db as unknown as PrismaService,
      {} as AuthService,
      {} as ProfessionalProfilesService,
    );
  });

  it('updates personal fields for a user without a profile and omits the profile response', async () => {
    db.user.findFirst.mockResolvedValue({
      id: 'authenticated-user',
      tenantId: 'tenant-1',
      professionalProfile: null,
    });
    db.user.update.mockResolvedValue({
      id: 'authenticated-user',
      tenantId: 'tenant-1',
      firstName: 'Ana',
      lastName: 'Ríos',
      phone: '+593 99 123 4567',
      role: 'ADMIN',
      professionalTitle: null,
      licenseNumber: null,
      professionalProfile: null,
    });

    const result = await updateSelf('tenant-1', 'authenticated-user', {
      firstName: 'Ana',
      phone: '+593 99 123 4567',
    });

    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'authenticated-user', tenantId: 'tenant-1' },
      include: { professionalProfile: true },
    });
    expect(db.applyRlsContext).toHaveBeenCalledWith(db, {
      tenantId: 'tenant-1',
      userId: 'authenticated-user',
    });
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'authenticated-user' },
        data: expect.objectContaining({ firstName: 'Ana', phone: '+593 99 123 4567' }),
      }),
    );
    expect(result).not.toHaveProperty('professionalProfile');
  });

  it('persists only editable profile fields and mirrors title and license to legacy user fields', async () => {
    db.user.findFirst.mockResolvedValue({
      id: 'professional-1',
      tenantId: 'tenant-1',
      professionalProfile: {
        specialtyId: 'specialty-1',
        professionalTitle: 'Título anterior',
        licenseNumber: 'LIC-OLD',
        bio: 'Biografía anterior',
        isActive: false,
      },
    });
    db.professionalProfile.update.mockResolvedValue({
      userId: 'professional-1',
      specialtyId: 'specialty-1',
      professionalTitle: 'Psicóloga clínica',
      licenseNumber: 'LIC-123',
      bio: 'Atención para adultos',
      isActive: false,
    });
    db.user.update.mockResolvedValue({
      id: 'professional-1',
      tenantId: 'tenant-1',
      firstName: 'Lucía',
      lastName: 'Vega',
      phone: null,
      role: 'PROFESIONAL',
      professionalTitle: 'Psicóloga clínica',
      licenseNumber: 'LIC-123',
      professionalProfile: {
        specialtyId: 'specialty-1',
        professionalTitle: 'Psicóloga clínica',
        licenseNumber: 'LIC-123',
        bio: 'Atención para adultos',
        isActive: false,
      },
    });

    const result = await updateSelf('tenant-1', 'professional-1', {
      firstName: 'Lucía',
      professionalProfile: {
        professionalTitle: 'Psicóloga clínica',
        licenseNumber: 'LIC-123',
        bio: 'Atención para adultos',
      },
    });

    expect(db.professionalProfile.update).toHaveBeenCalledWith({
      where: { userId: 'professional-1' },
      data: {
        professionalTitle: 'Psicóloga clínica',
        licenseNumber: 'LIC-123',
        bio: 'Atención para adultos',
      },
    });
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'professional-1' },
        data: expect.objectContaining({
          firstName: 'Lucía',
          professionalTitle: 'Psicóloga clínica',
          licenseNumber: 'LIC-123',
        }),
      }),
    );
    expect(result.professionalProfile).toMatchObject({
      specialtyId: 'specialty-1',
      isActive: false,
      bio: 'Atención para adultos',
    });
  });

  it('does not create a profile when a user without one submits profile data', async () => {
    db.user.findFirst.mockResolvedValue({
      id: 'admin-1',
      tenantId: 'tenant-1',
      professionalProfile: null,
    });

    await expect(
      updateSelf('tenant-1', 'admin-1', {
        professionalProfile: { bio: 'No profile exists' },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(db.professionalProfile.update).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('scopes self updates to the authenticated user and tenant', async () => {
    db.user.findFirst.mockResolvedValue(null);

    await expect(
      updateSelf('tenant-1', 'user-from-token', { firstName: 'Attempt' }),
    ).rejects.toThrow(NotFoundException);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
