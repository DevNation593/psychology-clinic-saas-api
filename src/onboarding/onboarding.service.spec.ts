import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SpecialtyCatalogService } from '../specialties/specialty-catalog.service';
import { TenantSpecialtiesService } from '../specialties/tenant-specialties.service';
import { CreateClinicOnboardingDto } from './dto/create-clinic-onboarding.dto';
import { OnboardingService } from './onboarding.service';

const psychology = {
  id: 'specialty-1',
  code: 'PSYCHOLOGY',
  name: 'Psicología',
  description: null,
  modules: [{ id: 'module-1', moduleKey: 'psychology.notes' }],
};
const nutrition = {
  id: 'specialty-2',
  code: 'NUTRITION',
  name: 'Nutrición',
  description: null,
  modules: [{ id: 'module-2', moduleKey: 'nutrition.assessment' }],
};

function input(overrides: Partial<CreateClinicOnboardingDto> = {}): CreateClinicOnboardingDto {
  return {
    clinicName: ' Clínica Centro ',
    contactEmail: ' CONTACT@EXAMPLE.COM ',
    contactPhone: ' 555-111 ',
    address: ' Calle 1 ',
    timezone: ' America/Guayaquil ',
    locale: ' es-EC ',
    specialtyCodes: [' psychology '],
    adminFirstName: ' Ana ',
    adminLastName: ' Pérez ',
    adminEmail: ' ANA@EXAMPLE.COM ',
    adminPassword: 'Password123!',
    adminProvidesCare: false,
    ...overrides,
  };
}

describe('OnboardingService', () => {
  let state: {
    tenants: any[];
    settings: any[];
    subscriptions: any[];
    users: any[];
    selections: string[];
  };
  let prisma: any;
  let catalog: any;
  let selection: any;
  let auth: any;
  let service: OnboardingService;

  beforeEach(() => {
    state = { tenants: [], settings: [], subscriptions: [], users: [], selections: [] };
    prisma = {
      $transaction: jest.fn(async (callback, options) => {
        expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const pending = structuredClone(state);
        const tx = {
          $executeRaw: jest.fn(async () => 1),
          user: {
            findFirst: jest.fn(async ({ where }) => {
              const filter = where.email;
              return (
                pending.users.find((u) => {
                  if (typeof filter === 'string') return u.email === filter;
                  if (filter.mode === 'insensitive') {
                    return u.email.toLowerCase() === filter.equals.toLowerCase();
                  }
                  return u.email === filter.equals;
                }) ?? null
              );
            }),
            create: jest.fn(async ({ data, select }) => {
              const row = { id: 'admin-1', ...data };
              pending.users.push(row);
              const visible = Object.fromEntries(
                Object.keys(select)
                  .filter((key) => select[key] === true)
                  .map((key) => [key, row[key]]),
              );
              if (select.professionalProfile) {
                visible.professionalProfile = data.professionalProfile?.create
                  ? {
                      isActive: true,
                      specialty: { id: 'specialty-1', code: 'PSYCHOLOGY', name: 'Psicología' },
                    }
                  : null;
              }
              return visible;
            }),
          },
          tenant: {
            create: jest.fn(async ({ data, select }) => {
              const row = { id: 'tenant-1', ...data };
              pending.tenants.push(row);
              return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
            }),
          },
          tenantSettings: {
            create: jest.fn(async ({ data }) => {
              pending.settings.push(data);
              return data;
            }),
          },
          tenantSubscription: {
            create: jest.fn(async ({ data }) => {
              const row = { id: 'subscription-1', currency: 'USD', ...data };
              pending.subscriptions.push(row);
              return row;
            }),
          },
          tenantSpecialty: {
            createMany: jest.fn(async ({ data }) => {
              pending.selections.push(...data.map((r) => r.specialtyId));
            }),
          },
        };
        prisma.lastTx = tx;
        const result = await callback(tx);
        state = pending;
        return result;
      }),
      applyRlsContext: jest.fn(async () => undefined),
    };
    auth = { hashPassword: jest.fn(async () => 'hashed-password') };
    catalog = {
      resolveActiveCodes: jest.fn(async (codes) => {
        const rows = [psychology, nutrition].filter((row) => codes.includes(row.code));
        if (rows.length !== codes.length)
          throw new NotFoundException({ code: 'SPECIALTY_NOT_AVAILABLE' });
        return rows;
      }),
    };
    selection = {
      applySelection: jest.fn(async (tx, { tenantId, specialties }) => {
        await tx.tenantSpecialty.createMany({
          data: specialties.map((s) => ({ tenantId, specialtyId: s.id })),
        });
        return {
          tenantId,
          specialties,
          modules: [{ moduleKey: 'psychology.notes', enabled: true }],
          pricing: {
            includedSpecialties: 1,
            selectedSpecialties: specialties.length,
            billableSpecialties: Math.max(0, specialties.length - 1),
            specialtyUnitPrice: 15,
            basePlanPrice: 0,
            featureAddonsPrice: 0,
            specialtyAddonsPrice: Math.max(0, specialties.length - 1) * 15,
            totalMonthly: Math.max(0, specialties.length - 1) * 15,
            currency: 'USD',
          },
        };
      }),
    };
    service = new OnboardingService(
      prisma as PrismaService,
      auth as AuthService,
      catalog as SpecialtyCatalogService,
      selection as TenantSpecialtiesService,
    );
  });

  it('creates a non-clinical administrator without a profile or consumed seat', async () => {
    const result = await service.create(input());
    expect(result.tenant).toMatchObject({
      id: 'tenant-1',
      name: 'Clínica Centro',
      email: 'contact@example.com',
      tenantType: 'CLINIC',
      onboardingCompleted: true,
    });
    expect(result.admin).toMatchObject({
      id: 'admin-1',
      email: 'ana@example.com',
      role: 'ADMIN',
      professionalProfile: null,
    });
    expect(state.settings).toEqual([
      { tenantId: 'tenant-1', timezone: 'America/Guayaquil', locale: 'es-EC' },
    ]);
    expect(state.subscriptions[0]).toMatchObject({
      tenantId: 'tenant-1',
      planType: 'TRIAL',
      status: 'TRIALING',
      seatsPsychologistsMax: 3,
      seatsPsychologistsUsed: 0,
      includedSpecialties: 1,
      specialtyPrice: expect.anything(),
      maxActivePatients: 20,
      storageGB: 0,
      monthlyNotificationsLimit: 100,
    });
    expect(Number(state.subscriptions[0].specialtyPrice)).toBe(15);
    expect(state.users[0].professionalProfile).toBeUndefined();
    expect(state.users[0].professionalSpecialties).toBeUndefined();
    expect(state.selections).toEqual(['specialty-1']);
  });

  it('creates exactly one active clinical profile and primary legacy specialty', async () => {
    const result = await service.create(
      input({
        adminProvidesCare: true,
        adminSpecialtyCode: ' psychology ',
        adminProfessionalTitle: ' Psicóloga ',
        adminLicenseNumber: ' 123 ',
        adminBio: ' Atención clínica ',
      }),
    );
    expect(state.users[0].professionalProfile.create).toMatchObject({
      specialtyId: 'specialty-1',
      professionalTitle: 'Psicóloga',
      licenseNumber: '123',
      bio: 'Atención clínica',
      isActive: true,
    });
    expect(state.users[0].professionalSpecialties.create).toEqual({
      specialtyId: 'specialty-1',
      isPrimary: true,
    });
    expect(state.users[0]).toMatchObject({ professionalTitle: 'Psicóloga', licenseNumber: '123' });
    expect(state.subscriptions[0].seatsPsychologistsUsed).toBe(1);
    expect(result.admin.professionalProfile).toMatchObject({
      specialty: { code: 'PSYCHOLOGY' },
      isActive: true,
    });
  });

  it('rejects an empty or duplicate normalized selection', async () => {
    await expect(service.create(input({ specialtyCodes: ['  '] }))).rejects.toMatchObject({
      response: { code: 'SPECIALTY_SELECTION_REQUIRED' },
    });
    await expect(
      service.create(input({ specialtyCodes: ['psychology', ' PSYCHOLOGY '] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a clinical specialty outside the selected set', async () => {
    await expect(
      service.create(input({ adminProvidesCare: true, adminSpecialtyCode: 'nutrition' })),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_SPECIALTY_NOT_SELECTED' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unavailable specialty and does not commit a tenant', async () => {
    await expect(service.create(input({ specialtyCodes: ['inactive'] }))).rejects.toMatchObject({
      response: { code: 'SPECIALTY_NOT_AVAILABLE' },
    });
    expect(state.tenants).toHaveLength(0);
  });

  it('rejects a duplicate administrator email with a stable conflict', async () => {
    state.users.push({ email: 'ana@example.com' });
    await expect(service.create(input())).rejects.toMatchObject({ status: 409 });
    expect(state.tenants).toHaveLength(0);
  });

  it('rejects a legacy support user with a mixed-case version of the administrator email', async () => {
    state.users.push({ email: 'Ana@Example.com' });
    await expect(service.create(input())).rejects.toMatchObject({
      status: 409,
      response: { message: 'El correo electrónico ya está en uso' },
    });
    expect(state.tenants).toHaveLength(0);
    expect(prisma.lastTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.lastTx.user.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('maps a database email uniqueness conflict to HTTP 409', async () => {
    const transact = prisma.$transaction.getMockImplementation();
    prisma.$transaction.mockImplementation(async (callback, options) =>
      transact(async (tx) => {
        tx.user.create.mockRejectedValueOnce({
          code: 'P2002',
          meta: { target: ['tenantId', 'email'] },
        });
        return callback(tx);
      }, options),
    );
    await expect(service.create(input())).rejects.toMatchObject({ status: 409 });
    expect(state.tenants).toHaveLength(0);
  });

  it('returns only explicitly selected safe data', async () => {
    const result = await service.create(input());
    expect(Object.keys(result).sort()).toEqual([
      'admin',
      'modules',
      'pricing',
      'specialties',
      'tenant',
    ]);
    expect(Object.keys(result.admin).sort()).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
      'professionalProfile',
      'role',
      'tenantId',
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /hashed-password|Password123|refreshToken|accessToken|stripe/,
    );
    expect(prisma.lastTx.user.create.mock.calls[0][0].select.password).toBeUndefined();
  });

  it('hashes before transaction, sets RLS after tenant creation, and shares the tx with selection', async () => {
    await service.create(input());
    expect(auth.hashPassword).toHaveBeenCalledWith('Password123!');
    expect(auth.hashPassword.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0],
    );
    expect(prisma.applyRlsContext).toHaveBeenCalledWith(prisma.lastTx, { tenantId: 'tenant-1' });
    expect(prisma.lastTx.tenant.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.applyRlsContext.mock.invocationCallOrder[0],
    );
    expect(catalog.resolveActiveCodes).toHaveBeenCalledWith(['PSYCHOLOGY'], prisma.lastTx);
    expect(selection.applySelection.mock.calls[0][0]).toBe(prisma.lastTx);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls back all writes if specialty provisioning fails inside the transaction callback', async () => {
    selection.applySelection.mockImplementationOnce(async (tx, { tenantId }) => {
      await tx.tenantSpecialty.createMany({ data: [{ tenantId, specialtyId: 'specialty-1' }] });
      throw new Error('provision failed');
    });
    await expect(service.create(input())).rejects.toThrow('provision failed');
    expect(state).toEqual({
      tenants: [],
      settings: [],
      subscriptions: [],
      users: [],
      selections: [],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('retries P2034 with a fresh transaction and never opens a nested transaction', async () => {
    const original = prisma.$transaction.getMockImplementation();
    prisma.$transaction
      .mockImplementationOnce(async () => {
        throw { code: 'P2034' };
      })
      .mockImplementation(original);
    await service.create(input());
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(state.tenants).toHaveLength(1);
    expect(auth.hashPassword).toHaveBeenCalledTimes(1);
  });

  it('does not retry ordinary failures or retry P2034 forever', async () => {
    selection.applySelection.mockRejectedValueOnce(new Error('ordinary'));
    await expect(service.create(input())).rejects.toThrow('ordinary');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    prisma.$transaction.mockReset().mockRejectedValue({ code: 'P2034' });
    await expect(service.create(input())).rejects.toMatchObject({ code: 'P2034' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
