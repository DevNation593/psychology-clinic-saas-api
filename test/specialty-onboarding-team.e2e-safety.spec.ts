describe('specialty onboarding E2E database safety', () => {
  it('rejects another allowlisted database before app initialization or cleanup', async () => {
    const databaseUrlFixture = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test';
    const previousDatabaseUrl = process.env.DATABASE_URL_TEST;
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalGlobals = {
      describe: globals.describe,
      beforeAll: globals.beforeAll,
      afterAll: globals.afterAll,
      it: globals.it,
    };

    let suiteBeforeAll: (() => Promise<void> | void) | undefined;
    const cleanDatabase = jest.fn();
    const prisma = {
      cleanDatabase,
      specialty: {
        upsert: jest.fn(async ({ where }: { where: { code: string } }) => ({ id: where.code })),
      },
      specialtyModule: { upsert: jest.fn() },
    };
    const app = {
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn(),
      init: jest.fn(),
      get: jest.fn((token: unknown) => {
        if (token === PrismaServiceToken) return prisma;
        return {};
      }),
      close: jest.fn(),
    };
    const createTestingModule = jest.fn(() => ({
      compile: jest.fn(async () => ({ createNestApplication: jest.fn(() => app) })),
    }));

    class PrismaServiceToken {}

    process.env.DATABASE_URL_TEST = databaseUrlFixture;
    globals.describe = (_name: string, defineSuite: () => void) => defineSuite();
    globals.beforeAll = (hook: () => Promise<void> | void) => {
      suiteBeforeAll = hook;
    };
    globals.afterAll = () => undefined;
    globals.it = () => undefined;

    let setupError: unknown;
    try {
      jest.doMock('@nestjs/common', () => ({ ValidationPipe: class ValidationPipe {} }));
      jest.doMock('@nestjs/testing', () => ({ Test: { createTestingModule } }));
      jest.doMock('@prisma/client', () => ({ PrismaClient: class PrismaClient {} }));
      jest.doMock('../src/app.module', () => ({ AppModule: class AppModule {} }));
      jest.doMock('../src/platform/platform-tenants.service', () => ({
        PlatformTenantsService: class {},
      }));
      jest.doMock('../src/prisma/prisma.service', () => ({ PrismaService: PrismaServiceToken }));
      jest.doMock('../src/specialties/tenant-specialties.service', () => ({
        TenantSpecialtiesService: class {},
      }));

      await jest.isolateModulesAsync(async () => {
        await import('./specialty-onboarding-team.e2e-spec');
      });
      expect(suiteBeforeAll).toBeDefined();
      expect(process.env.DATABASE_URL_TEST).toBe(databaseUrlFixture);
      try {
        await suiteBeforeAll?.();
      } catch (error) {
        setupError = error;
      }
    } finally {
      Object.assign(globals, originalGlobals);
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL_TEST;
      else process.env.DATABASE_URL_TEST = previousDatabaseUrl;
      jest.dontMock('@nestjs/common');
      jest.dontMock('@nestjs/testing');
      jest.dontMock('@prisma/client');
      jest.dontMock('../src/app.module');
      jest.dontMock('../src/platform/platform-tenants.service');
      jest.dontMock('../src/prisma/prisma.service');
      jest.dontMock('../src/specialties/tenant-specialties.service');
    }

    expect({
      setupErrorMessage: setupError instanceof Error ? setupError.message : undefined,
      appInitializations: createTestingModule.mock.calls.length,
      cleanupCalls: cleanDatabase.mock.calls.length,
    }).toEqual({
      setupErrorMessage: 'Specialty stage requires the exact disposable database',
      appInitializations: 0,
      cleanupCalls: 0,
    });
  });
});
