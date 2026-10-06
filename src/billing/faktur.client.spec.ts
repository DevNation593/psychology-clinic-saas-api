import { ServiceUnavailableException } from '@nestjs/common';
import { FakturClient, FakturInvoiceRequest } from './faktur.client';

const FAKTUR_VARIABLES = [
  'FAKTUR_API_URL',
  'FAKTUR_API_KEY',
  'FAKTUR_INVOICE_PATH',
  'FAKTUR_ENVIRONMENT',
] as const;

const payload: FakturInvoiceRequest = {
  idempotencyKey: 'tenant-1:key-1',
  customer: {
    legalName: 'Luis Vega',
    email: 'luis@example.com',
    identificationType: 'CEDULA',
    identificationNumber: '1712345678',
  },
  description: 'Consulta',
  subtotal: 20,
  tax: 0,
  total: 20,
  currency: 'USD',
};

describe('FakturClient', () => {
  const saved: Record<string, string | undefined> = {};
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    for (const name of FAKTUR_VARIABLES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    process.env.FAKTUR_API_URL = 'https://faktur.example/api/';
    process.env.FAKTUR_ENVIRONMENT = 'PRODUCTION';
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ externalId: 'ext-1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    for (const name of FAKTUR_VARIABLES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    global.fetch = originalFetch;
  });

  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it('sends the invoice to the URL, path and environment of the API with the key of the clinic', async () => {
    process.env.FAKTUR_INVOICE_PATH = '/v2/comprobantes';

    await new FakturClient().issueInvoice(payload, {
      apiKey: 'tenant-key',
      establishment: '001',
      emissionPoint: '002',
      nextSequential: 17,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://faktur.example/api/v2/comprobantes');
    expect(request.headers.Authorization).toBe('Bearer tenant-key');
    expect(sentBody()).toMatchObject({
      environment: 'PRODUCTION',
      establishment: '001',
      emissionPoint: '002',
      sequential: 17,
    });
  });

  it('uses /invoices when no path is defined', async () => {
    await new FakturClient().issueInvoice(payload, { apiKey: 'tenant-key' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://faktur.example/api/invoices');
  });

  it('sends the environment of the API when the invoice uses the key of the API', async () => {
    process.env.FAKTUR_API_KEY = 'platform-key';
    process.env.FAKTUR_ENVIRONMENT = 'TEST';

    await new FakturClient().issueInvoice(payload);

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer platform-key');
    expect(sentBody().environment).toBe('TEST');
  });

  it.each([
    ['is missing', undefined],
    ['is not TEST or PRODUCTION', 'staging'],
  ])('does not issue when the environment %s', async (_description, environment) => {
    if (environment === undefined) delete process.env.FAKTUR_ENVIRONMENT;
    else process.env.FAKTUR_ENVIRONMENT = environment;

    await expect(
      new FakturClient().issueInvoice(payload, { apiKey: 'tenant-key' }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
