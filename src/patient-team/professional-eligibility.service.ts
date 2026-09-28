import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EligibleProfessional, eligibleProfessionalSelect, TeamDb } from './patient-team.types';

@Injectable()
export class ProfessionalEligibilityService {
  async resolve(
    db: TeamDb,
    tenantId: string,
    professionalId: string,
    expectedSpecialtyId?: string,
  ): Promise<EligibleProfessional> {
    const user = await db.user.findFirst({
      where: { id: professionalId, tenantId },
      select: eligibleProfessionalSelect,
    });
    if (!user) throw new NotFoundException('Profesional no encontrado');
    if (!user.isActive || !user.professionalProfile?.isActive) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PROFESSIONAL_NOT_AUTHORIZED',
        message: 'La cuenta no tiene capacidad clínica activa.',
      });
    }

    const enabled = await db.tenantSpecialty.findUnique({
      where: {
        tenantId_specialtyId: {
          tenantId,
          specialtyId: user.professionalProfile.specialtyId,
        },
      },
    });
    if (!enabled || !user.professionalProfile.specialty.isActive) {
      throw new ConflictException({
        statusCode: 409,
        code: 'SPECIALTY_NOT_ENABLED',
        message: 'La especialidad no está habilitada para este consultorio.',
      });
    }
    if (expectedSpecialtyId && expectedSpecialtyId !== user.professionalProfile.specialtyId) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: 'PROFESSIONAL_SPECIALTY_MISMATCH',
        message: 'La especialidad no coincide con el perfil profesional.',
      });
    }

    return user;
  }

  async list(db: TeamDb, tenantId: string, specialtyId?: string): Promise<EligibleProfessional[]> {
    return db.user.findMany({
      where: {
        tenantId,
        isActive: true,
        professionalProfile: {
          is: {
            isActive: true,
            ...(specialtyId ? { specialtyId } : {}),
            specialty: {
              is: { isActive: true, tenants: { some: { tenantId } } },
            },
          },
        },
      },
      select: eligibleProfessionalSelect,
      orderBy: [
        { professionalProfile: { specialty: { name: 'asc' } } },
        { lastName: 'asc' },
        { firstName: 'asc' },
      ],
    });
  }
}
