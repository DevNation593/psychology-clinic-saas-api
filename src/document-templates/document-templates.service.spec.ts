import { PrismaService } from '../prisma/prisma.service';
import {
  DocumentTemplatesService,
  MAX_TEMPLATES_PER_TENANT,
  unknownTemplateVariables,
} from './document-templates.service';

describe('unknownTemplateVariables', () => {
  it('accepts the variables a client can fill in, with or without spaces', () => {
    expect(
      unknownTemplateVariables('{{paciente}} ({{ identificacion }}), {{edad}} años, {{fecha}}'),
    ).toEqual([]);
  });

  it('reports each unknown variable once', () => {
    expect(unknownTemplateVariables('{{direccion}} y {{direccion}}, {{Paciente}} {{}}')).toEqual([
      'direccion',
      'Paciente',
      '',
    ]);
  });
});

describe('DocumentTemplatesService', () => {
  const prisma = {
    documentTemplate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new DocumentTemplatesService(prisma as unknown as PrismaService);
  const input = {
    moduleKey: 'general.certificates',
    name: '  Reposo médico ',
    body: ' Certifico que {{paciente}} requiere reposo. ',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.documentTemplate.count.mockResolvedValue(0);
    prisma.documentTemplate.create.mockImplementation(({ data }) => ({
      id: 'template-1',
      ...data,
    }));
    prisma.documentTemplate.update.mockImplementation(({ data }) => ({
      id: 'template-1',
      ...data,
    }));
    prisma.documentTemplate.findFirst.mockResolvedValue({ id: 'template-1', tenantId: 'tenant-1' });
  });

  it('lists the templates of the tenant, only the active ones for whoever writes documents', async () => {
    await service.list('tenant-1', { moduleKey: 'general.consents', activeOnly: true });
    await service.list('tenant-1');

    expect(prisma.documentTemplate.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      moduleKey: 'general.consents',
      isActive: true,
    });
    expect(prisma.documentTemplate.findMany.mock.calls[1][0].where).toEqual({
      tenantId: 'tenant-1',
    });
  });

  it('stores a template trimmed, with its author', async () => {
    await service.create('tenant-1', 'master', input);

    expect(prisma.documentTemplate.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        moduleKey: 'general.certificates',
        name: 'Reposo médico',
        title: null,
        body: 'Certifico que {{paciente}} requiere reposo.',
        createdById: 'master',
      },
    });
  });

  it('refuses a variable no client fills in, in the title or in the body', async () => {
    await expect(
      service.create('tenant-1', 'master', { ...input, body: 'Vive en {{direccion}}.' }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'TEMPLATE_VARIABLE_UNKNOWN', variables: ['direccion'] },
    });
    await expect(
      service.update('tenant-1', 'template-1', { title: 'Para {{medico}}' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'TEMPLATE_VARIABLE_UNKNOWN' } });
    expect(prisma.documentTemplate.create).not.toHaveBeenCalled();
    expect(prisma.documentTemplate.update).not.toHaveBeenCalled();
  });

  it('answers 409 for a repeated name and for a full catalog', async () => {
    prisma.documentTemplate.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create('tenant-1', 'master', input)).rejects.toMatchObject({
      status: 409,
      response: { code: 'TEMPLATE_NAME_TAKEN' },
    });

    prisma.documentTemplate.count.mockResolvedValue(MAX_TEMPLATES_PER_TENANT);
    await expect(service.create('tenant-1', 'master', input)).rejects.toMatchObject({
      status: 409,
      response: { code: 'TEMPLATE_LIMIT_REACHED' },
    });
  });

  it('updates only what was sent and can take a template out of use', async () => {
    await service.update('tenant-1', 'template-1', { isActive: false, title: '  ' });

    expect(prisma.documentTemplate.findFirst.mock.calls[0][0].where).toEqual({
      id: 'template-1',
      tenantId: 'tenant-1',
    });
    expect(prisma.documentTemplate.update).toHaveBeenCalledWith({
      where: { id: 'template-1' },
      data: { title: null, isActive: false },
    });
  });

  it('does not find a template of another tenant', async () => {
    prisma.documentTemplate.findFirst.mockResolvedValue(null);

    await expect(service.update('tenant-1', 'foreign', { name: 'Otra' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
