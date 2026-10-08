import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';
import { TenantSettingsService } from './tenant-settings.service';

const CONNECTION_FIELDS = ['fakturApiUrl', 'fakturInvoicePath', 'fakturEnvironment'];

describe('TenantSettingsService Faktur settings', () => {
  const storedSettings = {
    tenantId: 'tenant-1',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    tenant: {
      legalName: 'Clínica Integral S.A.',
      taxIdentificationType: 'RUC',
      taxIdentificationNumber: '1790012345001',
      billingSettings: {
        apiKey: 'sk_live_abcd1234',
        establishment: '001',
        emissionPoint: '002',
        nextSequential: 17,
        isEnabled: true,
      },
    },
  };
  const prisma = {
    tenantSettings: { findUnique: jest.fn(), update: jest.fn() },
    tenant: { update: jest.fn() },
    billingSettings: { upsert: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: TenantSettingsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.tenantSettings.findUnique.mockResolvedValue(storedSettings);
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
    service = new TenantSettingsService(prisma as unknown as PrismaService);
  });

  it('returns the key masked and the numbering, without the connection of the API', async () => {
    const settings = await service.findOne('tenant-1');

    expect(settings).toMatchObject({
      fakturApiKey: '********1234',
      fakturEstablishment: '001',
      fakturEmissionPoint: '002',
      fakturNextSequential: 17,
      fakturEnabled: true,
    });
    for (const field of CONNECTION_FIELDS) expect(settings).not.toHaveProperty(field);
  });

  it('stores the key and numbering of the clinic, never a URL, path or environment', async () => {
    await service.update('tenant-1', {
      fakturApiKey: 'sk_live_new',
      fakturEstablishment: '003',
      fakturEnabled: true,
    });

    const { create, update } = prisma.billingSettings.upsert.mock.calls[0][0];
    expect(create).toMatchObject({ apiKey: 'sk_live_new', establishment: '003', isEnabled: true });
    expect(update).toMatchObject({ apiKey: 'sk_live_new', establishment: '003', isEnabled: true });
    for (const column of ['apiUrl', 'invoicePath', 'environment']) {
      expect(create).not.toHaveProperty(column);
      expect(update).not.toHaveProperty(column);
    }
  });

  it.each(CONNECTION_FIELDS)('rejects %s in the request', async (field) => {
    const dto = plainToInstance(UpdateTenantSettingsDto, { [field]: 'TEST' });

    // Same options as the global ValidationPipe of main.ts.
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.map((error) => error.property)).toEqual([field]);
  });
});
