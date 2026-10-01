import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

// Prisma reports a conflict it detects itself as P2034, but one raised inside a raw query
// arrives as P2010 carrying PostgreSQL's serialization_failure SQLSTATE.
function isSerializationConflict(error: unknown): boolean {
  const { code, meta } = error as { code?: string; meta?: { code?: string } };
  return code === 'P2034' || (code === 'P2010' && meta?.code === '40001');
}

export async function runSerializableTransaction<T>(
  prisma: PrismaService,
  tenantId: string,
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await prisma.applyRlsContext(tx, { tenantId, userId });
          return operation(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= 2) throw error;
    }
  }
}
