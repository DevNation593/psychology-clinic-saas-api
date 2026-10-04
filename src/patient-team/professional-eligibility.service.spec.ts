import { ProfessionalEligibilityService } from './professional-eligibility.service';
import { TeamDb } from './patient-team.types';

describe('ProfessionalEligibilityService', () => {
  const db = {
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    tenantSpecialty: { findUnique: jest.fn() },
  };
  const service = new ProfessionalEligibilityService();
  const teamDb = db as unknown as TeamDb;

  const specialty = (overrides: Record<string, unknown> = {}) => ({
    id: 'nutrition',
    code: 'NUTRITION',
    name: 'Nutrición',
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });
  const profile = (overrides: Record<string, unknown> = {}) => ({
    userId: 'professional-1',
    specialtyId: 'nutrition',
    specialty: specialty(),
    professionalTitle: null,
    licenseNumber: null,
    bio: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });
  const professional = (overrides: Record<string, unknown> = {}) => ({
    id: 'professional-1',
    tenantId: 'tenant-1',
    firstName: 'Ana',
    lastName: 'López',
    email: 'ana@example.test',
    role: 'PROFESIONAL',
    isActive: true,
    professionalProfile: profile(),
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    db.user.findFirst.mockResolvedValue(professional());
    db.tenantSpecialty.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      specialtyId: 'nutrition',
    });
  });

  it('accepts an ADMIN with an active professional profile', async () => {
    db.user.findFirst.mockResolvedValue(professional({ id: 'admin-clinical', role: 'MASTER' }));

    await expect(
      service.resolve(teamDb, 'tenant-1', 'admin-clinical', 'nutrition'),
    ).resolves.toMatchObject({
      id: 'admin-clinical',
      professionalProfile: { specialtyId: 'nutrition' },
    });
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'admin-clinical', tenantId: 'tenant-1' },
      select: expect.objectContaining({ professionalProfile: expect.any(Object) }),
    });
  });

  it('does not infer clinical capacity from PROFESIONAL role alone', async () => {
    db.user.findFirst.mockResolvedValue(professional({ professionalProfile: null }));

    await expect(service.resolve(teamDb, 'tenant-1', 'professional-1')).rejects.toMatchObject({
      status: 403,
      response: { code: 'PROFESSIONAL_NOT_AUTHORIZED' },
    });
    expect(db.tenantSpecialty.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing professional', async () => {
    db.user.findFirst.mockResolvedValue(null);

    await expect(service.resolve(teamDb, 'tenant-1', 'professional-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(db.tenantSpecialty.findUnique).not.toHaveBeenCalled();
  });

  it('does not resolve a professional belonging to another tenant', async () => {
    db.user.findFirst.mockImplementation(async ({ where }: { where: { tenantId?: string } }) =>
      where.tenantId === 'tenant-1' ? null : professional({ tenantId: 'tenant-2' }),
    );

    await expect(service.resolve(teamDb, 'tenant-1', 'professional-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'professional-1', tenantId: 'tenant-1' },
      select: expect.any(Object),
    });
    expect(db.tenantSpecialty.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['account', { isActive: false }],
    ['profile', { professionalProfile: profile({ isActive: false }) }],
  ])('rejects an inactive %s before checking specialty', async (_label, overrides) => {
    db.user.findFirst.mockResolvedValue(professional(overrides));

    await expect(service.resolve(teamDb, 'tenant-1', 'professional-1')).rejects.toMatchObject({
      status: 403,
      response: { code: 'PROFESSIONAL_NOT_AUTHORIZED' },
    });
    expect(db.tenantSpecialty.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a specialty unavailable to this tenant', async () => {
    db.tenantSpecialty.findUnique.mockResolvedValue(null);

    await expect(service.resolve(teamDb, 'tenant-1', 'professional-1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'SPECIALTY_NOT_ENABLED' },
    });
    expect(db.tenantSpecialty.findUnique).toHaveBeenCalledWith({
      where: { tenantId_specialtyId: { tenantId: 'tenant-1', specialtyId: 'nutrition' } },
    });
  });

  it('rejects an inactive catalog specialty', async () => {
    db.user.findFirst.mockResolvedValue(
      professional({ professionalProfile: profile({ specialty: specialty({ isActive: false }) }) }),
    );

    await expect(service.resolve(teamDb, 'tenant-1', 'professional-1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'SPECIALTY_NOT_ENABLED' },
    });
  });

  it('rejects a requested specialty that differs from the active profile', async () => {
    await expect(
      service.resolve(teamDb, 'tenant-1', 'professional-1', 'psychology'),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROFESSIONAL_SPECIALTY_MISMATCH' },
    });
  });

  it('checks specialty availability before expected-specialty mismatch', async () => {
    db.tenantSpecialty.findUnique.mockResolvedValue(null);

    await expect(
      service.resolve(teamDb, 'tenant-1', 'professional-1', 'psychology'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'SPECIALTY_NOT_ENABLED' },
    });
  });

  it.each([undefined, 'nutrition'])(
    'lists active eligible professionals with specialty filter %s and stable sorting',
    async (specialtyId) => {
      const admin = professional({ id: 'admin-clinical', role: 'MASTER' });
      db.user.findMany.mockResolvedValue([admin]);

      await expect(service.list(teamDb, 'tenant-1', specialtyId)).resolves.toEqual([admin]);
      expect(db.user.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          isActive: true,
          professionalProfile: {
            is: {
              isActive: true,
              ...(specialtyId ? { specialtyId } : {}),
              specialty: {
                is: { isActive: true, tenants: { some: { tenantId: 'tenant-1' } } },
              },
            },
          },
        },
        select: expect.objectContaining({ professionalProfile: expect.any(Object) }),
        orderBy: [
          { professionalProfile: { specialty: { name: 'asc' } } },
          { lastName: 'asc' },
          { firstName: 'asc' },
        ],
      });
    },
  );
});
