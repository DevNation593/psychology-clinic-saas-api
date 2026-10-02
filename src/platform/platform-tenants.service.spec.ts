import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SpecialtyCatalogService } from '../specialties/specialty-catalog.service';
import { TenantSpecialtiesService } from '../specialties/tenant-specialties.service';
import { SECTION_KEYS } from '../common/sections/section-catalog';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { PlatformTenantsService } from './platform-tenants.service';

const TEMP_PASSWORD = 'Temp-Pass-9876';
const psychology = {
  id: 'specialty-1',
  code: 'PSYCHOLOGY',
  name: 'Psicología',
  description: null,
  modules: [{ id: 'module-1', moduleKey: 'psychology.notes' }],
};

function input(overrides: Partial<CreatePlatformTenantDto> = {}): CreatePlatformTenantDto {
  return {
    name: ' Clínica Centro ',
    email: ' CONTACT@EXAMPLE.COM ',
    phone: ' 555-111 ',
    address: ' Calle 1 ',
    tenantType: 'CLINIC',
    timezone: ' America/Guayaquil ',
    locale: ' es-EC ',
    masterFirstName: ' Ana ',
    masterLastName: ' Pérez ',
    masterEmail: ' ANA@EXAMPLE.COM ',
    temporaryPassword: TEMP_PASSWORD,
    planType: 'TRIAL',
    specialtyCodes: ['psychology'],
    ...overrides,
  };
}

describe('PlatformTenantsService', () => {
  let state: {
    tenants: any[];
    settings: any[];
    subscriptions: any[];
    users: any[];
    modules: any[];
    events: any[];
    selections: string[];
  };
  let prisma: any;
  let catalog: any;
  let selection: any;
  let auth: any;
  let service: PlatformTenantsService;

  function readTenant(source: typeof state, id: string) {
    const tenant = source.tenants.find((t) => t.id === id && !t.isPlatform);
    if (!tenant) return null;
    const subscription = source.subscriptions.find((s) => s.tenantId === id);
    const master = source.users.find((u) => u.tenantId === id && u.role === 'MASTER');
    return {
      id: tenant.id,
      name: tenant.name,
      email: tenant.email,
      phone: tenant.phone ?? null,
      address: tenant.address ?? null,
      tenantType: tenant.tenantType,
      isActive: true,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      subscription: subscription && {
        planType: subscription.planType,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt ?? null,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd ?? null,
        seatsPsychologistsMax: subscription.seatsPsychologistsMax,
        seatsPsychologistsUsed: subscription.seatsPsychologistsUsed,
        maxActivePatients: subscription.maxActivePatients,
        activePatientsCount: 0,
        monthlyNotificationsSent: 0,
        basePrice: subscription.basePrice,
        currency: subscription.currency,
      },
      users: master
        ? [
            {
              id: master.id,
              firstName: master.firstName,
              lastName: master.lastName,
              email: master.email,
              mustChangePassword: master.mustChangePassword,
            },
          ]
        : [],
      specialties: source.selections.map(() => ({
        specialty: { id: psychology.id, code: psychology.code, name: psychology.name },
      })),
      enabledModules: source.modules
        .filter((m) => m.tenantId === id)
        .map((m) => ({ moduleKey: m.moduleKey, enabled: m.enabled })),
    };
  }

  beforeEach(() => {
    state = {
      tenants: [],
      settings: [],
      subscriptions: [],
      users: [],
      modules: [],
      events: [],
      selections: [],
    };
    prisma = {
      tenant: {
        findFirst: jest.fn(async ({ where }) => readTenant(state, where.id)),
      },
      $transaction: jest.fn(async (callback, options) => {
        expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const pending = structuredClone(state);
        const tx = {
          $executeRaw: jest.fn(async () => 1),
          user: {
            findFirst: jest.fn(async ({ where }) => {
              const filter = where.email;
              return (
                pending.users.find((u) => u.email.toLowerCase() === filter.equals.toLowerCase()) ??
                null
              );
            }),
            create: jest.fn(async ({ data, select }) => {
              const row = { id: 'master-1', ...data };
              pending.users.push(row);
              return Object.fromEntries(
                Object.keys(select)
                  .filter((key) => select[key] === true)
                  .map((key) => [key, row[key]]),
              );
            }),
          },
          tenant: {
            create: jest.fn(async ({ data, select }) => {
              const row = { id: 'tenant-1', ...data };
              pending.tenants.push(row);
              return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
            }),
            findFirst: jest.fn(async ({ where }) => readTenant(pending, where.id)),
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
          tenantModule: {
            createMany: jest.fn(async ({ data }) => {
              pending.modules.push(...data);
            }),
          },
          subscriptionEvent: {
            create: jest.fn(async ({ data }) => {
              pending.events.push(data);
              return data;
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
        const rows = [psychology].filter((row) => codes.includes(row.code));
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
        return { tenantId, specialties, modules: [], pricing: {} };
      }),
    };
    service = new PlatformTenantsService(
      prisma as PrismaService,
      auth as AuthService,
      catalog as SpecialtyCatalogService,
      selection as TenantSpecialtiesService,
    );
  });

  it('creates tenant, settings, subscription, master and eight section rows in one transaction', async () => {
    const result = await service.create(input(), 'admin-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(state.tenants).toHaveLength(1);
    expect(state.tenants[0]).toMatchObject({
      name: 'Clínica Centro',
      email: 'contact@example.com',
      phone: '555-111',
      address: 'Calle 1',
      tenantType: 'CLINIC',
    });
    expect(state.settings).toEqual([
      { tenantId: 'tenant-1', timezone: 'America/Guayaquil', locale: 'es-EC' },
    ]);
    expect(state.subscriptions).toHaveLength(1);
    expect(state.users).toHaveLength(1);
    expect(state.modules).toHaveLength(8);
    expect(state.modules.map((m) => m.moduleKey).sort()).toEqual([...SECTION_KEYS].sort());
    expect(result.tenant).toMatchObject({ id: 'tenant-1', name: 'Clínica Centro' });
    expect(result.sections).toHaveLength(8);
    expect(prisma.applyRlsContext).toHaveBeenCalledWith(prisma.lastTx, { tenantId: 'tenant-1' });
    expect(selection.applySelection.mock.calls[0][0]).toBe(prisma.lastTx);
    expect(result.specialties).toEqual([
      { id: 'specialty-1', code: 'PSYCHOLOGY', name: 'Psicología' },
    ]);
  });

  it('creates the master with role MASTER, mustChangePassword true and no professional profile', async () => {
    const result = await service.create(input(), 'admin-1');
    expect(state.users[0]).toMatchObject({
      tenantId: 'tenant-1',
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      role: 'MASTER',
      mustChangePassword: true,
      isActive: true,
    });
    expect(state.users[0].professionalProfile).toBeUndefined();
    expect(state.users[0].professionalSpecialties).toBeUndefined();
    expect(state.subscriptions[0].seatsPsychologistsUsed).toBe(0);
    expect(result.usage.seatsPsychologistsUsed).toBe(0);
    expect(result.master).toEqual({
      id: 'master-1',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      mustChangePassword: true,
    });
  });

  it('uses the plan defaults when sections are omitted', async () => {
    const result = await service.create(input({ planType: 'TRIAL', tenantType: 'CLINIC' }), 'a');
    const enabled = Object.fromEntries(state.modules.map((m) => [m.moduleKey, m.enabled]));
    expect(enabled['core.tasks']).toBe(false);
    expect(enabled['core.team']).toBe(true);
    expect(enabled['core.patients']).toBe(true);
    expect(result.sections.find((s) => s.key === 'core.tasks')?.enabled).toBe(false);
  });

  it('stores the explicit section list and disables the rest', async () => {
    await service.create(input({ sections: ['core.patients', 'core.calendar'] }), 'a');
    const enabled = state.modules.filter((m) => m.enabled).map((m) => m.moduleKey);
    expect(enabled.sort()).toEqual(['core.calendar', 'core.patients']);
    expect(state.modules).toHaveLength(8);
  });

  it('rejects an unknown section and an unmet dependency before writing', async () => {
    await expect(service.create(input({ sections: ['core.nope'] }), 'a')).rejects.toMatchObject({
      response: { code: 'SECTION_UNKNOWN' },
    });
    await expect(service.create(input({ sections: ['core.calendar'] }), 'a')).rejects.toMatchObject(
      { response: { code: 'SECTION_DEPENDENCY' } },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.hashPassword).not.toHaveBeenCalled();
  });

  it('rejects a plan that does not match the tenant type with PLAN_TYPE_MISMATCH', async () => {
    await expect(
      service.create(input({ tenantType: 'PERSONAL', planType: 'CLINIC_PRO' }), 'a'),
    ).rejects.toMatchObject({ status: 400, response: { code: 'PLAN_TYPE_MISMATCH' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('starts a TRIAL as TRIALING with a 14 day trial and trial seats', async () => {
    const before = Date.now();
    await service.create(input({ tenantType: 'CLINIC' }), 'a');
    const clinic = state.subscriptions[0];
    expect(clinic).toMatchObject({
      planType: 'TRIAL',
      status: 'TRIALING',
      seatsPsychologistsMax: 3,
      maxActivePatients: 20,
    });
    const days = (clinic.trialEndsAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);
    expect(state.events).toHaveLength(0);

    state.users = [];
    state.subscriptions = [];
    await service.create(input({ tenantType: 'PERSONAL', masterEmail: 'other@example.com' }), 'a');
    expect(state.subscriptions[0]).toMatchObject({
      status: 'TRIALING',
      seatsPsychologistsMax: 1,
      maxActivePatients: 10,
    });
  });

  it('starts a paid plan ACTIVE with a one month period, no payment and a SUBSCRIPTION_ACTIVATED event by the actor', async () => {
    await service.create(input({ planType: 'CLINIC_BASIC' }), 'admin-7');
    const sub = state.subscriptions[0];
    expect(sub).toMatchObject({
      planType: 'CLINIC_BASIC',
      status: 'ACTIVE',
      seatsPsychologistsMax: 3,
      maxActivePatients: 150,
      trialEndsAt: null,
    });
    const months =
      (sub.currentPeriodEnd.getFullYear() - sub.currentPeriodStart.getFullYear()) * 12 +
      sub.currentPeriodEnd.getMonth() -
      sub.currentPeriodStart.getMonth();
    expect(months).toBe(1);
    expect(prisma.lastTx.subscriptionPayment).toBeUndefined();
    expect(state.events).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventType: 'SUBSCRIPTION_ACTIVATED',
        newPlan: 'CLINIC_BASIC',
        newStatus: 'ACTIVE',
        triggeredByUserId: 'admin-7',
      }),
    ]);
  });

  it('rejects a master e-mail that exists with different casing', async () => {
    state.users.push({ email: 'Ana@Example.com', role: 'MASTER' });
    await expect(service.create(input(), 'a')).rejects.toBeInstanceOf(ConflictException);
    expect(state.tenants).toHaveLength(0);
    expect(prisma.lastTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.lastTx.user.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('rejects a master e-mail that belongs to a platform ADMIN', async () => {
    state.users.push({ email: 'ana@example.com', role: 'ADMIN', tenantId: 'platform' });
    await expect(service.create(input(), 'a')).rejects.toMatchObject({ status: 409 });
    expect(state.tenants).toHaveLength(0);
  });

  it('never stores or returns the temporary password in clear text', async () => {
    const result = await service.create(input(), 'a');
    expect(auth.hashPassword).toHaveBeenCalledWith(TEMP_PASSWORD);
    expect(auth.hashPassword.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0],
    );
    expect(state.users[0].password).toBe('hashed-password');
    expect(prisma.lastTx.user.create.mock.calls[0][0].select.password).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain(TEMP_PASSWORD);
    expect(JSON.stringify(result)).not.toMatch(/hashed-password|Temp-Pass/);
  });

  it('answers 404 for the platform tenant and for an unknown id', async () => {
    state.tenants.push({ id: 'platform-1', isPlatform: true });
    await expect(service.findOne('platform-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tenant.findFirst.mock.calls[0][0].where).toEqual({
      id: 'platform-1',
      isPlatform: false,
    });
  });

  it('builds the catalog defaults for every plan and tenant type that match', () => {
    const catalogResult = service.getSectionCatalog();
    expect(catalogResult.sections.map((s) => s.key)).toEqual([...SECTION_KEYS]);
    const pairs = catalogResult.defaults.map((d) => `${d.planType}/${d.tenantType}`).sort();
    expect(pairs).toEqual(
      [
        'TRIAL/PERSONAL',
        'TRIAL/CLINIC',
        'PERSONAL_BASIC/PERSONAL',
        'PERSONAL_PRO/PERSONAL',
        'CLINIC_BASIC/CLINIC',
        'CLINIC_PRO/CLINIC',
        'CLINIC_ENTERPRISE/CLINIC',
      ].sort(),
    );
    const trialClinic = catalogResult.defaults.find(
      (d) => d.planType === 'TRIAL' && d.tenantType === 'CLINIC',
    )!;
    expect(trialClinic.sections).not.toContain('core.tasks');
    expect(trialClinic.sections).toContain('core.team');
  });
});
