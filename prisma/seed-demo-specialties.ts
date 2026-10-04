import type { Appointment, Patient, Prisma, User } from '@prisma/client';
import { buildDemoSpecialtyScenarios, type DemoSpecialtyKey } from './demo-specialty-scenarios';

type DemoSpecialtySeedClient = Pick<
  Prisma.TransactionClient,
  'user' | 'patient' | 'appointment' | 'patientProfessional' | 'specialtyRecord'
>;

type DemoSpecialtySeedResult = Record<
  DemoSpecialtyKey,
  {
    professional: User;
    patient: Patient;
    appointment: Appointment;
  }
>;

export interface SeedDemoSpecialtiesOptions {
  tenantId: string;
  hashedPassword: string;
  assignedById: string;
  specialtyIds: Record<DemoSpecialtyKey, string>;
  referenceDate: Date;
}

function dateFromReference(referenceDate: Date, days: number): Date {
  const date = new Date(referenceDate);
  date.setDate(date.getDate() + days);
  return date;
}

export async function seedDemoSpecialties(
  db: DemoSpecialtySeedClient,
  options: SeedDemoSpecialtiesOptions,
): Promise<DemoSpecialtySeedResult> {
  const result = {} as DemoSpecialtySeedResult;

  for (const scenario of buildDemoSpecialtyScenarios()) {
    const specialtyId = options.specialtyIds[scenario.key];
    const professional = await db.user.create({
      data: {
        tenantId: options.tenantId,
        email: scenario.professional.email,
        password: options.hashedPassword,
        firstName: scenario.professional.firstName,
        lastName: scenario.professional.lastName,
        phone: scenario.professional.phone,
        role: scenario.professional.role,
        managedByProvider: scenario.professional.managedByProvider,
        isActive: true,
        emailVerified: true,
        activatedAt: dateFromReference(
          options.referenceDate,
          -scenario.professional.activationDaysAgo,
        ),
        avatarUrl: `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(
          `${scenario.professional.firstName} ${scenario.professional.lastName}`,
        )}`,
        professionalTitle: scenario.professional.title,
        licenseNumber: scenario.professional.licenseNumber,
        professionalProfile: {
          create: {
            specialtyId,
            professionalTitle: scenario.professional.title,
            licenseNumber: scenario.professional.licenseNumber,
            isActive: true,
          },
        },
        professionalSpecialties: {
          create: { specialtyId, isPrimary: true },
        },
      },
    });

    const patient = await db.patient.create({
      data: {
        tenantId: options.tenantId,
        firstName: scenario.patient.firstName,
        lastName: scenario.patient.lastName,
        email: scenario.patient.email,
        phone: scenario.patient.phone,
        dateOfBirth: new Date(scenario.patient.dateOfBirth),
        gender: scenario.patient.gender,
        assignedPsychologistId: professional.id,
        notes: scenario.patient.notes,
      },
    });

    await db.patientProfessional.create({
      data: {
        tenantId: options.tenantId,
        patientId: patient.id,
        professionalId: professional.id,
        assignedById: options.assignedById,
        isActive: true,
      },
    });

    const startTime = dateFromReference(
      options.referenceDate,
      scenario.appointment.startDaysFromNow,
    );
    const appointment = await db.appointment.create({
      data: {
        tenantId: options.tenantId,
        patientId: patient.id,
        psychologistId: professional.id,
        professionalId: professional.id,
        specialtyId,
        title: scenario.appointment.title,
        description: scenario.appointment.description,
        startTime,
        endTime: new Date(startTime.getTime() + scenario.appointment.duration * 60 * 1000),
        duration: scenario.appointment.duration,
        status: scenario.appointment.status,
        location: scenario.appointment.location,
        isOnline: scenario.appointment.isOnline,
      },
    });

    await db.specialtyRecord.createMany({
      data: scenario.records.map((record) => ({
        tenantId: options.tenantId,
        patientId: patient.id,
        professionalId: professional.id,
        specialtyId,
        ...(scenario.appointment.status === 'COMPLETED' ? { appointmentId: appointment.id } : {}),
        moduleKey: record.moduleKey,
        data: record.data as Prisma.InputJsonValue,
        notes: record.notes,
        recordDate: dateFromReference(options.referenceDate, record.recordDaysFromNow ?? 0),
      })),
    });

    result[scenario.key] = { professional, patient, appointment };
  }

  return result;
}
