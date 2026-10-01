import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type TeamDb = PrismaService | Prisma.TransactionClient;
export type TeamActor = Pick<AuthUser, 'userId' | 'tenantId' | 'role'>;

export const eligibleProfessionalSelect = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  isActive: true,
  professionalProfile: {
    include: { specialty: true },
  },
} satisfies Prisma.UserSelect;

export type EligibleProfessional = Prisma.UserGetPayload<{
  select: typeof eligibleProfessionalSelect;
}>;
