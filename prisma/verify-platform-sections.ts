import { PrismaClient } from '@prisma/client';
import { auditPlatformSections, hasBlockingIssues } from './audit-platform-sections';

const client = new PrismaClient();
auditPlatformSections(client)
  .then((audit) => {
    console.log(JSON.stringify(audit, null, 2));
    if (hasBlockingIssues(audit)) process.exitCode = 1;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
