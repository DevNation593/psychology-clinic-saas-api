import { PrismaService } from '../prisma/prisma.service';
import { FormDefinitionsService } from './form-definitions.service';

describe('FormDefinitionsService', () => {
  const schema = {
    sections: [
      {
        key: 'injury',
        title: 'Lesión',
        fields: [{ key: 'detail', label: 'Detalle', type: 'text', required: true }],
      },
    ],
  };
  const changedSchema = {
    sections: [
      {
        key: 'injury',
        title: 'Lesión',
        fields: [
          { key: 'detail', label: 'Detalle', type: 'text', required: true },
          { key: 'side', label: 'Lado', type: 'text' },
        ],
      },
    ],
  };
  const stored = (overrides = {}) => ({
    id: 'form-1',
    tenantId: 'tenant-1',
    name: 'Ficha de lesión',
    currentVersion: 1,
    versions: [{ version: 1, schema }],
    ...overrides,
  });
  const db = {
    formDefinition: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    specialty: { findFirst: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn(), applyRlsContext: jest.fn() };
  const service = new FormDefinitionsService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
    db.formDefinition.count.mockResolvedValue(0);
    db.formDefinition.create.mockImplementation(({ data }) => Promise.resolve(data));
    db.formDefinition.update.mockImplementation(({ data }) => Promise.resolve(data));
    db.formDefinition.findFirst.mockResolvedValue(stored());
  });

  describe('create', () => {
    it('stores the sanitized schema as version 1', async () => {
      await service.create('tenant-1', 'master', {
        name: '  Ficha de lesión ',
        category: 'Evaluación',
        schema: { sections: [{ ...schema.sections[0], ignored: true }] },
      });

      expect(db.formDefinition.create.mock.calls[0][0].data).toEqual({
        tenantId: 'tenant-1',
        name: 'Ficha de lesión',
        description: null,
        category: 'Evaluación',
        specialtyId: null,
        createdById: 'master',
        versions: { create: { version: 1, schema, createdById: 'master' } },
      });
    });

    it('rejects an invalid schema before touching the database', async () => {
      await expect(
        service.create('tenant-1', 'master', { name: 'Vacío', schema: { sections: [] } }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'FORM_DEFINITION_INVALID' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('restricts the form to a specialty only when the clinic has it enabled', async () => {
      db.specialty.findFirst.mockResolvedValueOnce({ id: 'physio' });
      await service.create('tenant-1', 'master', {
        name: 'Ficha',
        specialtyCode: 'physiotherapy',
        schema,
      });
      expect(db.specialty.findFirst.mock.calls[0][0].where).toEqual({
        code: 'PHYSIOTHERAPY',
        isActive: true,
        tenants: { some: { tenantId: 'tenant-1' } },
      });
      expect(db.formDefinition.create.mock.calls[0][0].data.specialtyId).toBe('physio');

      db.specialty.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.create('tenant-1', 'master', { name: 'Otra', specialtyCode: 'DENTISTRY', schema }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'SPECIALTY_NOT_ENABLED' } });
    });

    it('answers 409 when the name is taken or the clinic reached its form limit', async () => {
      db.formDefinition.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint'), {
          code: 'P2002',
          meta: { target: ['tenantId', 'name'] },
        }),
      );
      await expect(
        service.create('tenant-1', 'master', { name: 'Ficha', schema }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'FORM_NAME_TAKEN' } });

      db.formDefinition.count.mockResolvedValueOnce(200);
      await expect(
        service.create('tenant-1', 'master', { name: 'Ficha', schema }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'FORM_LIMIT_REACHED' } });
    });
  });

  describe('update', () => {
    it('adds a changed schema as the next version and leaves earlier versions alone', async () => {
      await service.update('tenant-1', 'form-1', 'master', { schema: changedSchema });

      expect(db.formDefinition.findFirst.mock.calls[0][0].where).toEqual({
        id: 'form-1',
        tenantId: 'tenant-1',
      });
      expect(db.formDefinition.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'form-1' },
        data: {
          currentVersion: 2,
          versions: { create: { version: 2, schema: changedSchema, createdById: 'master' } },
        },
      });
    });

    it('creates no version when the schema is the same, whatever its key order', async () => {
      const reordered = {
        sections: [
          {
            fields: [{ required: true, type: 'text', label: 'Detalle', key: 'detail' }],
            title: 'Lesión',
            key: 'injury',
          },
        ],
      };

      await service.update('tenant-1', 'form-1', 'master', {
        name: 'Ficha nueva',
        schema: reordered,
      });

      expect(db.formDefinition.update.mock.calls[0][0].data).toEqual({ name: 'Ficha nueva' });
    });

    it('changes name, description, category and status in place', async () => {
      await service.update('tenant-1', 'form-1', 'master', {
        description: ' ',
        category: null,
        isActive: false,
        specialtyCode: null,
      });

      expect(db.formDefinition.update.mock.calls[0][0].data).toEqual({
        description: null,
        category: null,
        specialtyId: null,
        isActive: false,
      });
    });

    it('does not find a form of another tenant', async () => {
      db.formDefinition.findFirst.mockResolvedValue(null);

      await expect(
        service.update('tenant-1', 'foreign', 'master', { isActive: false }),
      ).rejects.toMatchObject({ status: 404 });
      expect(db.formDefinition.update).not.toHaveBeenCalled();
    });

    it('reports a concurrent edit of the same version as a conflict to reload', async () => {
      db.formDefinition.update.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint'), {
          code: 'P2002',
          meta: { target: ['formDefinitionId', 'version'] },
        }),
      );

      await expect(
        service.update('tenant-1', 'form-1', 'master', { schema: changedSchema }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'FORM_VERSION_CONFLICT' } });
    });
  });

  it('lists only the forms of the tenant', async () => {
    db.formDefinition.findMany.mockResolvedValue([]);

    await service.list('tenant-1');

    expect(db.formDefinition.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-1' });
  });
});
