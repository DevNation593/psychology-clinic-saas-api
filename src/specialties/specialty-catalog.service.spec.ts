import { PrismaService } from '../prisma/prisma.service';
import { SpecialtyCatalogService } from './specialty-catalog.service';

describe('SpecialtyCatalogService', () => {
  const psychology = {
    id: 'psy',
    code: 'PSYCHOLOGY',
    name: 'Psicología',
    description: 'Atención psicológica',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    modules: [
      { id: 'assessment', specialtyId: 'psy', moduleKey: 'psychology.assessment' },
      { id: 'notes', specialtyId: 'psy', moduleKey: 'psychology.notes' },
    ],
  };
  const nutrition = {
    id: 'nut',
    code: 'NUTRITION',
    name: 'Nutrición',
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-02'),
    modules: [{ id: 'diet', specialtyId: 'nut', moduleKey: 'nutrition.diet' }],
  };
  const prisma = { specialty: { findMany: jest.fn() } };
  const service = new SpecialtyCatalogService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('lists active specialties by name with modules ordered by key and public fields only', async () => {
    prisma.specialty.findMany.mockResolvedValue([nutrition, psychology]);

    await expect(service.listActive()).resolves.toEqual([
      {
        id: 'nut',
        code: 'NUTRITION',
        name: 'Nutrición',
        description: null,
        modules: [{ id: 'diet', moduleKey: 'nutrition.diet' }],
      },
      {
        id: 'psy',
        code: 'PSYCHOLOGY',
        name: 'Psicología',
        description: 'Atención psicológica',
        modules: [
          { id: 'assessment', moduleKey: 'psychology.assessment' },
          { id: 'notes', moduleKey: 'psychology.notes' },
        ],
      },
    ]);
    expect(prisma.specialty.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      include: { modules: { orderBy: { moduleKey: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  });

  it('uses the supplied Prisma client for catalog reads', async () => {
    const client = { specialty: { findMany: jest.fn().mockResolvedValue([]) } };

    await expect(service.listActive(client as unknown as PrismaService)).resolves.toEqual([]);

    expect(client.specialty.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      include: { modules: { orderBy: { moduleKey: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    expect(prisma.specialty.findMany).not.toHaveBeenCalled();
  });

  it('normalizes, deduplicates, and returns specialties in requested order', async () => {
    prisma.specialty.findMany.mockResolvedValue([nutrition, psychology]);

    await expect(
      service.resolveActiveCodes([' psychology ', 'NUTRITION', 'psychology', ' nutrition ']),
    ).resolves.toEqual([
      {
        id: 'psy',
        code: 'PSYCHOLOGY',
        name: 'Psicología',
        description: 'Atención psicológica',
        modules: [
          { id: 'assessment', moduleKey: 'psychology.assessment' },
          { id: 'notes', moduleKey: 'psychology.notes' },
        ],
      },
      {
        id: 'nut',
        code: 'NUTRITION',
        name: 'Nutrición',
        description: null,
        modules: [{ id: 'diet', moduleKey: 'nutrition.diet' }],
      },
    ]);
    expect(prisma.specialty.findMany).toHaveBeenCalledWith({
      where: { code: { in: ['PSYCHOLOGY', 'NUTRITION'] }, isActive: true },
      include: { modules: { orderBy: { moduleKey: 'asc' } } },
    });
  });

  it.each([{ codes: [] }, { codes: [' ', '  '] }])(
    'rejects an empty normalized selection: $codes',
    async ({ codes }) => {
      await expect(service.resolveActiveCodes(codes)).rejects.toMatchObject({
        status: 400,
        response: { code: 'SPECIALTY_SELECTION_REQUIRED' },
      });
      expect(prisma.specialty.findMany).not.toHaveBeenCalled();
    },
  );

  it('rejects the first unavailable code in normalized request order', async () => {
    prisma.specialty.findMany.mockResolvedValue([psychology]);

    await expect(
      service.resolveActiveCodes([' nutrition ', 'PSYCHOLOGY', 'CARDIOLOGY']),
    ).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'SPECIALTY_NOT_AVAILABLE',
        message: 'La especialidad NUTRITION no existe o está inactiva.',
      },
    });
  });

  it('uses the supplied Prisma client to resolve codes', async () => {
    const client = { specialty: { findMany: jest.fn().mockResolvedValue([psychology]) } };

    await expect(
      service.resolveActiveCodes(['psychology'], client as unknown as PrismaService),
    ).resolves.toEqual([
      {
        id: 'psy',
        code: 'PSYCHOLOGY',
        name: 'Psicología',
        description: 'Atención psicológica',
        modules: [
          { id: 'assessment', moduleKey: 'psychology.assessment' },
          { id: 'notes', moduleKey: 'psychology.notes' },
        ],
      },
    ]);
    expect(client.specialty.findMany).toHaveBeenCalledWith({
      where: { code: { in: ['PSYCHOLOGY'] }, isActive: true },
      include: { modules: { orderBy: { moduleKey: 'asc' } } },
    });
    expect(prisma.specialty.findMany).not.toHaveBeenCalled();
  });
});
