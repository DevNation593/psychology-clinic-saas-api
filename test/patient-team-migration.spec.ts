import { spawnSync } from 'node:child_process';
import { Prisma } from '@prisma/client';

describe('patient team appointment migration', () => {
  // Missing canonical relations would prevent callers from addressing the team while
  // removing legacy columns would break clients during the compatibility window.
  it('exposes canonical team relations alongside the legacy appointment and patient fields', () => {
    const models = Prisma.dmmf.datamodel.models;
    const team = models.find((model) => model.name === 'PatientProfessional');
    expect(team?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'id',
        'tenantId',
        'patientId',
        'professionalId',
        'assignedAt',
        'assignedById',
        'isActive',
        'createdAt',
        'updatedAt',
      ]),
    );
    expect(team?.uniqueFields).toContainEqual(['patientId', 'professionalId']);
    const appointment = models.find((model) => model.name === 'Appointment');
    expect(appointment?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'professionalId', isRequired: false }),
        expect.objectContaining({ name: 'psychologistId', isRequired: true }),
        expect.objectContaining({ name: 'specialtyId' }),
      ]),
    );
    expect(models.find((model) => model.name === 'Patient')?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'assignedPsychologistId' }),
        expect.objectContaining({ name: 'professionalAssignments', type: 'PatientProfessional' }),
      ]),
    );
  });

  // A missing npm entry point or a guard moved after connection would produce an
  // npm/connection error instead of rejecting this reachable-looking unsafe input.
  it('runs the npm verifier entry point and rejects an unsafe base URL without disclosing it', () => {
    const result = spawnSync(
      process.execPath,
      [process.env.npm_execpath!, 'run', '--silent', 'prisma:verify-patient-team-migration'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          DATABASE_URL_TEST:
            'postgresql://secret-user:secret-password@127.0.0.1:1/psic_clinic_test',
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('Specialty stage requires the exact disposable database');
    expect(result.stdout).not.toContain('secret');
  });
});
