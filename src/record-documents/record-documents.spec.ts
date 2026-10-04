import { ConfigService } from '@nestjs/config';
import { FormSchema } from '../clinical-forms/form-schema';
import { PatientFilesService } from '../patient-files/patient-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SpecialtyRecordsService } from '../specialty-records/specialty-records.service';
import { documentSections, formatFieldValue } from './document-content';
import { RecordDocumentsService } from './record-documents.service';
import { renderRecordPdf } from './record-pdf';

// 1x1 transparent PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const schema: FormSchema = {
  sections: [
    {
      key: 'certificate',
      title: 'Certificado',
      fields: [
        {
          key: 'type',
          label: 'Tipo',
          type: 'select',
          options: [{ value: 'REPOSO', label: 'Certificado de reposo' }],
        },
        { key: 'body', label: 'Texto', type: 'textarea' },
        { key: 'restDays', label: 'Días de reposo', type: 'integer', unit: 'días' },
        { key: 'validFrom', label: 'Desde', type: 'date' },
        { key: 'urgent', label: 'Urgente', type: 'checkbox' },
        { key: 'weightKg', label: 'Peso', type: 'decimal', unit: 'kg' },
      ],
    },
    {
      key: 'items',
      title: 'Medicamentos',
      fields: [
        {
          key: 'items',
          label: 'Indicaciones',
          type: 'table',
          columns: [
            { key: 'name', label: 'Medicamento', type: 'text' },
            {
              key: 'route',
              label: 'Vía',
              type: 'select',
              options: [{ value: 'ORAL', label: 'Oral' }],
            },
          ],
        },
      ],
    },
    {
      key: 'signatures',
      title: 'Firma',
      fields: [{ key: 'signature', label: 'Firma de quien acepta', type: 'signature' }],
    },
    { key: 'empty', title: 'Sin datos', fields: [{ key: 'other', label: 'Otro', type: 'text' }] },
  ],
};

describe('documentSections', () => {
  it('writes each value as a reader expects it, in the order of the definition', () => {
    const sections = documentSections(schema, {
      type: 'REPOSO',
      body: 'Requiere reposo.',
      restDays: 3,
      validFrom: '2026-10-03',
      urgent: false,
      weightKg: 72.5,
      items: [{ name: 'Ibuprofeno', route: 'ORAL' }, { name: 'Paracetamol' }],
      signature: `data:image/png;base64,${PNG}`,
    });

    expect(sections.map((section) => section.title)).toEqual([
      'Certificado',
      'Medicamentos',
      'Firma',
    ]);
    expect(sections[0].rows).toEqual([
      { label: 'Tipo', text: 'Certificado de reposo' },
      { label: 'Texto', text: 'Requiere reposo.' },
      { label: 'Días de reposo', text: '3 días' },
      { label: 'Desde', text: '03/10/2026' },
      // An unchecked box is left out.
      { label: 'Peso', text: '72,5 kg' },
    ]);
    expect(sections[1].rows).toEqual([
      {
        label: 'Indicaciones',
        table: {
          columns: ['Medicamento', 'Vía'],
          rows: [
            ['Ibuprofeno', 'Oral'],
            ['Paracetamol', ''],
          ],
        },
      },
    ]);
    expect(sections[2].rows).toEqual([
      { label: 'Firma de quien acepta', image: Buffer.from(PNG, 'base64') },
    ]);
  });

  it('formats choices and scales by their labels', () => {
    expect(
      formatFieldValue(
        {
          key: 'areas',
          label: 'Áreas',
          type: 'multiselect',
          options: [
            { value: 'A', label: 'Cuello' },
            { value: 'B', label: 'Espalda' },
          ],
        },
        ['A', 'B'],
      ),
    ).toBe('Cuello, Espalda');
    expect(
      formatFieldValue(
        {
          key: 'pain',
          label: 'Dolor',
          type: 'scale',
          min: 0,
          max: 10,
          options: [{ value: '7', label: 'Intenso' }],
        },
        7,
      ),
    ).toBe('7 · Intenso');
    expect(formatFieldValue({ key: 'ok', label: 'Acepta', type: 'checkbox' }, true)).toBe('Sí');
  });
});

const pdfInput = (sections = documentSections(schema, { body: 'Texto' })) => ({
  clinic: { name: 'Centro Bienestar', address: 'Av. Siempre Viva 123', phone: '+593 2 123 4567' },
  title: 'Certificado',
  issuedOn: '3 de octubre de 2026',
  patient: { name: 'Ana Pérez', identification: '1712345678', birthDate: '10/5/90' },
  professional: { name: 'Sofía Ruiz', title: 'Psicóloga clínica', licenseNumber: 'MSP-123' },
  sections,
  notes: 'Control en 7 días.',
  verification: { code: 'ABCD-EFGH-JKMN-PQRS', url: 'https://app.test/verify/ABCD-EFGH-JKMN-PQRS' },
});

describe('renderRecordPdf', () => {
  const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

  it('produces a one-page PDF for an ordinary record, with its images', async () => {
    const pdf = await renderRecordPdf(
      pdfInput(
        documentSections(schema, {
          type: 'REPOSO',
          body: 'Requiere reposo.',
          items: [{ name: 'Ibuprofeno', route: 'ORAL' }],
          signature: `data:image/png;base64,${PNG}`,
        }),
      ),
    );

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pages(pdf)).toBe(1);
    // The QR and the signature, each with the mask of its transparency.
    expect(pdf.toString('latin1').match(/\/Subtype \/Image/g)).toHaveLength(4);
  });

  it('continues on more pages when the text is long, and survives characters outside Latin-1', async () => {
    const long = Array.from({ length: 120 }, (_, n) => `Párrafo ${n}: texto 😀 → ≥ “citas”.`).join(
      '\n',
    );

    const pdf = await renderRecordPdf(pdfInput(documentSections(schema, { body: long })));

    expect(pages(pdf)).toBeGreaterThan(1);
  });
});

describe('RecordDocumentsService', () => {
  const prisma = {
    tenant: { findUnique: jest.fn() },
    patient: { findFirst: jest.fn() },
    branch: { findFirst: jest.fn() },
  };
  const records = { findDocument: jest.fn() };
  const files = { upload: jest.fn() };
  const config = { get: jest.fn() };
  const service = new RecordDocumentsService(
    prisma as unknown as PrismaService,
    records as unknown as SpecialtyRecordsService,
    files as unknown as PatientFilesService,
    config as unknown as ConfigService,
  );
  const actor = { userId: 'pro', role: 'PROFESIONAL', specialtyId: 'psy' };
  const found = (moduleKey: string) => ({
    record: {
      id: 'record-1',
      moduleKey,
      verificationCode: 'ABCDEFGHJKMNPQRS',
      // 02:00 UTC on the 4th is still the 3rd in Guayaquil.
      recordDate: new Date('2026-10-04T02:00:00.000Z'),
      data: { body: 'Requiere reposo.' },
      notes: null,
      specialty: { name: 'Psicología' },
      professional: {
        firstName: 'Sofía',
        lastName: 'Ruiz',
        professionalProfile: { professionalTitle: 'Psicóloga clínica', licenseNumber: 'MSP-123' },
      },
    },
    definition: { name: 'Consentimiento informado', schemaVersion: 1, schema },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockReturnValue('https://app.test/');
    prisma.tenant.findUnique.mockResolvedValue({
      name: 'Centro Bienestar',
      address: null,
      phone: null,
      settings: { timezone: 'America/Guayaquil' },
    });
    prisma.patient.findFirst.mockResolvedValue({
      firstName: 'Ana',
      lastName: 'Pérez',
      dateOfBirth: new Date('1990-05-10T00:00:00.000Z'),
      identificationNumber: '1712345678',
    });
    prisma.branch.findFirst.mockResolvedValue({ address: 'Av. 1', city: 'Quito', phone: '099' });
    files.upload.mockImplementation(async (_t, _p, _a, part) => ({ id: 'file-1', part }));
  });

  it('stores the PDF among the files of the patient, in the folder of its kind', async () => {
    records.findDocument.mockResolvedValue(found('general.consents'));

    await service.issue('tenant-1', 'patient-1', 'record-1', actor);

    expect(records.findDocument).toHaveBeenCalledWith('tenant-1', 'patient-1', 'record-1', actor);
    const [tenantId, patientId, uploader, part, dto] = files.upload.mock.calls[0];
    expect([tenantId, patientId, uploader]).toEqual(['tenant-1', 'patient-1', actor]);
    expect(part).toMatchObject({
      originalname: 'consentimiento-informado-2026-10-03.pdf',
      mimetype: 'application/pdf',
      size: part.buffer.length,
    });
    expect(part.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(dto).toEqual({
      category: 'CONSENTIMIENTO',
      description: 'Documento generado. Código de verificación ABCD-EFGH-JKMN-PQRS.',
    });
  });

  it.each([
    ['general.prescriptions', 'RECETA'],
    ['general.certificates', 'INFORME'],
    ['custom.form-1', 'INFORME'],
  ])('files %s under %s', async (moduleKey, category) => {
    records.findDocument.mockResolvedValue(found(moduleKey));

    await service.issue('tenant-1', 'patient-1', 'record-1', actor);

    expect(files.upload.mock.calls[0][4].category).toBe(category);
  });

  it('points the QR to the public page of the web, whatever the trailing slash', () => {
    expect(service.verificationUrl('ABCDEFGHJKMNPQRS')).toBe(
      'https://app.test/verify/ABCD-EFGH-JKMN-PQRS',
    );
  });

  it('does not generate anything for a record it cannot read', async () => {
    records.findDocument.mockRejectedValue(new Error('CLINICAL_RECORD_NOT_FOUND'));

    await expect(service.issue('tenant-1', 'patient-1', 'gone', actor)).rejects.toThrow();
    expect(files.upload).not.toHaveBeenCalled();
  });
});
