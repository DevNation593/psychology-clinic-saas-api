import * as fs from 'fs';
import {
  importDiagnosisCodes,
  parseDiagnosisCsv,
  STARTER_DIAGNOSIS_CODES,
} from '../../prisma/import-diagnosis-codes';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogsService } from './catalogs.service';

describe('CatalogsService', () => {
  const db = {
    diagnosisCode: { findMany: jest.fn(), upsert: jest.fn() },
    medication: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new CatalogsService(db as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    db.medication.count.mockResolvedValue(0);
    db.medication.create.mockImplementation(({ data }) => Promise.resolve(data));
    db.medication.update.mockImplementation(({ data }) => Promise.resolve(data));
  });

  describe('searchDiagnosisCodes', () => {
    it('asks for at least two characters', async () => {
      expect(await service.searchDiagnosisCodes(' f ')).toEqual([]);
      expect(db.diagnosisCode.findMany).not.toHaveBeenCalled();
    });

    it('puts code matches first and completes with description matches', async () => {
      db.diagnosisCode.findMany
        .mockResolvedValueOnce([
          { system: 'CIE10', code: 'F32.1', description: 'Episodio depresivo moderado' },
        ])
        .mockResolvedValueOnce([
          { system: 'CIE10', code: 'K02.1', description: 'Caries de la dentina' },
        ]);

      const found = await service.searchDiagnosisCodes(' f32 ', 'CIE10');

      expect(found.map(({ code }) => code)).toEqual(['F32.1', 'K02.1']);
      expect(db.diagnosisCode.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          isActive: true,
          system: 'CIE10',
          code: { startsWith: 'f32', mode: 'insensitive' },
        },
        take: 20,
      });
      expect(db.diagnosisCode.findMany.mock.calls[1][0]).toMatchObject({
        where: {
          description: { contains: 'f32', mode: 'insensitive' },
          NOT: { code: { startsWith: 'f32', mode: 'insensitive' } },
        },
        take: 19,
      });
    });

    it('ignores an unknown classification instead of filtering by it', async () => {
      db.diagnosisCode.findMany.mockResolvedValue([]);

      await service.searchDiagnosisCodes('caries', 'DSM5');

      expect(db.diagnosisCode.findMany.mock.calls[0][0].where).not.toHaveProperty('system');
    });
  });

  describe('medications', () => {
    it('searches only the active medications of the tenant by name or active ingredient', async () => {
      db.medication.findMany.mockResolvedValue([]);

      await service.listMedications('tenant-1', ' ibu ');

      expect(db.medication.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          tenantId: 'tenant-1',
          isActive: true,
          OR: [
            { commercialName: { contains: 'ibu', mode: 'insensitive' } },
            { activeIngredient: { contains: 'ibu', mode: 'insensitive' } },
          ],
        },
        take: 20,
      });
    });

    it('lists the whole catalog, inactive included, without a search term', async () => {
      db.medication.findMany.mockResolvedValue([]);

      await service.listMedications('tenant-1');

      expect(db.medication.findMany.mock.calls[0][0]).toEqual({
        where: { tenantId: 'tenant-1' },
        orderBy: { commercialName: 'asc' },
      });
    });

    it('creates a medication with trimmed fields', async () => {
      await service.createMedication('tenant-1', {
        commercialName: ' Ibuprofeno MK ',
        concentration: '400 mg',
        presentation: ' ',
      });

      expect(db.medication.create.mock.calls[0][0].data).toEqual({
        tenantId: 'tenant-1',
        commercialName: 'Ibuprofeno MK',
        activeIngredient: null,
        concentration: '400 mg',
        presentation: null,
        pharmaceuticalForm: null,
      });
    });

    it('updates only a medication of the tenant', async () => {
      db.medication.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.updateMedication('tenant-1', 'foreign', { isActive: false }),
      ).rejects.toMatchObject({ status: 404 });
      expect(db.medication.findFirst.mock.calls[0][0].where).toEqual({
        id: 'foreign',
        tenantId: 'tenant-1',
      });

      db.medication.findFirst.mockResolvedValueOnce({ id: 'med-1' });
      await service.updateMedication('tenant-1', 'med-1', {
        isActive: false,
        activeIngredient: '',
      });
      expect(db.medication.update.mock.calls[0][0]).toEqual({
        where: { id: 'med-1' },
        data: { activeIngredient: null, isActive: false },
      });
    });
  });
});

describe('diagnosis code import', () => {
  it('reads quoted descriptions, skips the header and normalizes the code', () => {
    expect(
      parseDiagnosisCsv(
        'system,code,description\r\nCIE10,f32.1,"Episodio depresivo moderado"\nCIE10,E46,"Desnutrición, no especificada"\n\n',
      ),
    ).toEqual([
      { system: 'CIE10', code: 'F32.1', description: 'Episodio depresivo moderado' },
      { system: 'CIE10', code: 'E46', description: 'Desnutrición, no especificada' },
    ]);
  });

  it('stops at the first incomplete row or unknown classification', () => {
    expect(() => parseDiagnosisCsv('CIE10,F32.1')).toThrow('Línea 1');
    expect(() => parseDiagnosisCsv('CIE10,F32.1,Leve\nDSM5,296.2,Depresión')).toThrow('Línea 2');
  });

  it('ships a starter file with unique, well-formed CIE-10 codes', () => {
    const rows = parseDiagnosisCsv(fs.readFileSync(STARTER_DIAGNOSIS_CODES, 'utf8'));

    expect(rows.length).toBeGreaterThan(50);
    expect(new Set(rows.map(({ code }) => code)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.system).toBe('CIE10');
      expect(row.code).toMatch(/^[A-Z]\d{2}(\.\d)?$/);
    }
  });

  it('upserts every row by classification and code', async () => {
    const upsert = jest.fn();

    const count = await importDiagnosisCodes({ diagnosisCode: { upsert } } as never, [
      { system: 'CIE10', code: 'F32.1', description: 'Episodio depresivo moderado' },
    ]);

    expect(count).toBe(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { system_code: { system: 'CIE10', code: 'F32.1' } },
      update: { description: 'Episodio depresivo moderado', isActive: true },
      create: { system: 'CIE10', code: 'F32.1', description: 'Episodio depresivo moderado' },
    });
  });
});
