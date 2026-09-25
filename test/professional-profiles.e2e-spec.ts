import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { SubscriptionService } from '../src/subscription/subscription.service';
import { ProfessionalProfilesService } from '../src/professional-profiles/professional-profiles.service';
import { TEST_PASSWORD } from './helpers/create-test-tenant';
import { randomUUID } from 'crypto';

jest.setTimeout(30000);

describe('Professional profile transition (E2E)', () => {
  let app: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let tenants: TenantsService;
  let users: UsersService;
  let auth: AuthService;
  let subscription: SubscriptionService;
  let profiles: ProfessionalProfilesService;
  let tenantId: string;
  let otherTenantId: string;
  let specialtyId: string;
  let otherSpecialtyId: string;
  let legacyId: string;
  let canonicalId: string;

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    prisma = app.get(PrismaService);
    tenants = app.get(TenantsService);
    users = app.get(UsersService);
    auth = app.get(AuthService);
    subscription = app.get(SubscriptionService);
    profiles = app.get(ProfessionalProfilesService);
    await prisma.cleanDatabase();

    const first = await tenants.create({
      name: 'Profiles clinic',
      tenantType: 'CLINIC',
      email: 'profiles-clinic@test.invalid',
      adminFirstName: 'Default',
      adminLastName: 'Admin',
      adminEmail: 'profiles-admin@test.invalid',
      adminPassword: TEST_PASSWORD,
    });
    const second = await tenants.create({
      name: 'Other clinic',
      tenantType: 'CLINIC',
      email: 'profiles-other@test.invalid',
      adminFirstName: 'Other',
      adminLastName: 'Admin',
      adminEmail: 'other-admin@test.invalid',
      adminPassword: TEST_PASSWORD,
    });
    tenantId = first.id;
    otherTenantId = second.id;
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: {
        planType: 'CLINIC_BASIC',
        status: 'ACTIVE',
        seatsPsychologistsMax: 5,
      },
    });
    await prisma.tenantSubscription.update({
      where: { tenantId: otherTenantId },
      data: {
        planType: 'CLINIC_BASIC',
        status: 'ACTIVE',
        seatsPsychologistsMax: 5,
      },
    });
    const specialty = await prisma.specialty.create({
      data: { code: `E2E-PROFILES-OWN-${randomUUID()}`, name: 'Own specialty' },
    });
    const other = await prisma.specialty.create({
      data: { code: `E2E-PROFILES-OTHER-${randomUUID()}`, name: 'Other specialty' },
    });
    specialtyId = specialty.id;
    otherSpecialtyId = other.id;
    await prisma.tenantSpecialty.create({ data: { tenantId, specialtyId } });
    await prisma.tenantSpecialty.create({
      data: { tenantId: otherTenantId, specialtyId: otherSpecialtyId },
    });
  });

  afterAll(async () => app?.close());

  it('creates a legacy PSICOLOGO with one enabled specialty and preserves its response', async () => {
    const result = await users.create(
      {
        tenantId,
        email: 'legacy@test.invalid',
        firstName: 'Legacy',
        lastName: 'Professional',
        role: 'PSICOLOGO',
        professionalProfile: { specialtyId },
      },
      'fixture-actor',
    );
    legacyId = result.id;
    expect(result).toMatchObject({
      role: 'PSICOLOGO',
      professionalProfile: { specialtyId, isActive: true, specialty: { id: specialtyId } },
      professionalSpecialties: [{ specialtyId, isPrimary: true }],
    });
    expect(result).not.toHaveProperty('password');
    expect(await profiles.countActiveProfiles(tenantId)).toBe(1);
  });

  it('returns the same profile shape for canonical PROFESIONAL', async () => {
    const result = await users.create(
      {
        tenantId,
        email: 'canonical@test.invalid',
        firstName: 'Canonical',
        lastName: 'Professional',
        role: 'PROFESIONAL',
        professionalProfile: { specialtyId },
      },
      'fixture-actor',
    );
    canonicalId = result.id;
    expect(result).toMatchObject({
      role: 'PROFESIONAL',
      professionalProfile: { specialtyId, isActive: true, specialty: { id: specialtyId } },
      professionalSpecialties: [{ specialtyId, isPrimary: true }],
    });
    expect(await profiles.countActiveProfiles(tenantId)).toBe(2);
  });

  it('counts a clinical CLIENTE administrator and exposes its profile on login and refresh', async () => {
    const result = await users.create(
      {
        tenantId,
        email: 'clinical-admin@test.invalid',
        password: TEST_PASSWORD,
        firstName: 'Clinical',
        lastName: 'Admin',
        role: 'CLIENTE',
        professionalProfile: { specialtyId },
      },
      'fixture-actor',
    );
    expect(result.professionalProfile).toMatchObject({ isActive: true, specialtyId });
    expect((await subscription.getUsageMetrics(tenantId)).usage.seats.used).toBe(3);
    const login = await auth.login({ email: result.email, password: TEST_PASSWORD });
    expect(login.user).toMatchObject({
      id: result.id,
      role: 'CLIENTE',
      professionalProfile: { specialty: { id: specialtyId, name: 'Own specialty' } },
    });
    const token = await auth.refreshTokens(login.refreshToken);
    expect(token.user).toMatchObject({
      id: result.id,
      role: 'CLIENTE',
      professionalProfile: { specialty: { id: specialtyId, name: 'Own specialty' } },
    });
  });

  it('does not count an administrator without a profile', async () => {
    const admin = await prisma.user.findFirstOrThrow({
      where: { tenantId, email: 'profiles-admin@test.invalid' },
    });
    expect(admin.role).toBe('CLIENTE');
    expect((await users.findOne(tenantId, admin.id)).professionalProfile).toBeNull();
    expect((await subscription.getUsageMetrics(tenantId)).usage.seats.used).toBe(3);
  });

  it('rejects a specialty enabled only for another tenant', async () => {
    await expect(
      users.create(
        {
          tenantId,
          email: 'foreign@test.invalid',
          firstName: 'Foreign',
          lastName: 'Specialty',
          role: 'PROFESIONAL',
          professionalProfile: { specialtyId: otherSpecialtyId },
        },
        'fixture-actor',
      ),
    ).rejects.toMatchObject({
      response: { code: 'SPECIALTY_NOT_ENABLED' },
    });
    expect(await profiles.countActiveProfiles(tenantId)).toBe(3);
  });

  it.each(['PSICOLOGO', 'PROFESIONAL'])(
    'filters %s across legacy and canonical professionals',
    async (role) => {
      const result = await users.findAll(tenantId, { role });
      expect(result.map((user) => user.id)).toEqual(
        expect.arrayContaining([legacyId, canonicalId]),
      );
      expect(result).toHaveLength(2);
    },
  );

  it('allows exactly one of two concurrent activations for the final seat', async () => {
    const candidates = await Promise.all(
      ['a', 'b'].map((name) =>
        users.create(
          {
            tenantId,
            email: `race-${name}@test.invalid`,
            firstName: 'Race',
            lastName: name,
            role: 'ADMIN',
            professionalProfile: { specialtyId, isActive: false },
          },
          'fixture-actor',
        ),
      ),
    );
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { seatsPsychologistsMax: 4 },
    });
    const original = profiles.assertSeatAvailable.bind(profiles);
    let arrivals = 0;
    let release: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seatCheck = jest
      .spyOn(profiles, 'assertSeatAvailable')
      .mockImplementation(async (id, tx) => {
        await original(id, tx);
        arrivals++;
        if (arrivals === 2) release();
        if (arrivals <= 2) await barrier;
      });
    try {
      const results = await Promise.allSettled(
        candidates.map((candidate) =>
          users.update(tenantId, candidate.id, {
            professionalProfile: { specialtyId, isActive: true },
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { response: { code: 'PROFESSIONAL_SEAT_LIMIT_REACHED' } },
      });
      expect((await subscription.getUsageMetrics(tenantId)).usage.seats.used).toBe(4);
    } finally {
      seatCheck.mockRestore();
    }
  });
});
