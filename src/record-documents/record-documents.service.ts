import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicalActor } from '../clinical-access/clinical-actor';
import { PatientFileCategory } from '../patient-files/dto/patient-file.dto';
import { PatientFilesService } from '../patient-files/patient-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SpecialtyRecordsService } from '../specialty-records/specialty-records.service';
import { formatVerificationCode } from '../specialty-records/verification-code';
import { documentSections } from './document-content';
import { renderRecordPdf } from './record-pdf';

/** The folder of the patient's files a generated document belongs in. */
const CATEGORY_OF: Record<string, PatientFileCategory> = {
  'general.prescriptions': 'RECETA',
  'general.consents': 'CONSENTIMIENTO',
};

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'documento';

/**
 * Renders a clinical record as a PDF on the server and keeps it among the files of the patient,
 * so that the document that was handed over stays in the history exactly as it was printed.
 */
@Injectable()
export class RecordDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: SpecialtyRecordsService,
    private readonly files: PatientFilesService,
    private readonly config: ConfigService,
  ) {}

  /** The address a third party opens to check a document by its code. */
  verificationUrl(code: string): string {
    const base = (this.config.get<string>('FRONTEND_URL') || 'http://localhost:4200').replace(
      /\/+$/,
      '',
    );
    return `${base}/verify/${formatVerificationCode(code)}`;
  }

  async issue(tenantId: string, patientId: string, recordId: string, actor: ClinicalActor) {
    const { record, definition } = await this.records.findDocument(
      tenantId,
      patientId,
      recordId,
      actor,
    );
    const [tenant, patient, mainBranch] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          address: true,
          phone: true,
          settings: { select: { timezone: true } },
        },
      }),
      this.prisma.patient.findFirst({
        where: { id: patientId, tenantId },
        select: {
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          identificationNumber: true,
        },
      }),
      this.prisma.branch.findFirst({
        where: { tenantId, isMain: true },
        select: { address: true, city: true, phone: true },
      }),
    ]);
    if (!tenant || !patient) throw new NotFoundException('Paciente no encontrado');

    const timeZone = tenant.settings?.timezone ?? 'UTC';
    const longDate = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone });
    // A date of birth has no time zone: it is the same day everywhere.
    const birthDate = patient.dateOfBirth
      ? new Intl.DateTimeFormat('es', { dateStyle: 'short', timeZone: 'UTC' }).format(
          patient.dateOfBirth,
        )
      : null;
    const code = formatVerificationCode(record.verificationCode);
    const profile = record.professional.professionalProfile;

    const pdf = await renderRecordPdf({
      clinic: {
        name: tenant.name,
        address:
          tenant.address ??
          ([mainBranch?.address, mainBranch?.city].filter(Boolean).join(', ') || null),
        phone: tenant.phone ?? mainBranch?.phone,
      },
      title: definition.name,
      issuedOn: longDate.format(record.recordDate),
      patient: {
        name: `${patient.firstName} ${patient.lastName}`.trim(),
        identification: patient.identificationNumber,
        birthDate,
      },
      professional: {
        name: `${record.professional.firstName} ${record.professional.lastName}`.trim(),
        title: profile?.professionalTitle,
        licenseNumber: profile?.licenseNumber,
        specialty: record.specialty?.name,
      },
      sections: documentSections(definition.schema, record.data as Record<string, unknown>),
      notes: record.notes,
      verification: { code, url: this.verificationUrl(record.verificationCode) },
    });

    // en-CA writes a date as YYYY-MM-DD; the day is the one of the clinic, as in the document.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(record.recordDate);
    return this.files.upload(
      tenantId,
      patientId,
      actor,
      {
        originalname: `${slug(definition.name)}-${day}.pdf`,
        mimetype: 'application/pdf',
        size: pdf.length,
        buffer: pdf,
      },
      {
        category: CATEGORY_OF[record.moduleKey] ?? 'INFORME',
        description: `Documento generado. Código de verificación ${code}.`,
      },
    );
  }
}
