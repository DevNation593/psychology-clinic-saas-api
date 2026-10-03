import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export interface PlatformAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export async function createPlatformAdmin(
  client: PrismaClient,
  input: PlatformAdminInput,
): Promise<{ tenantId: string; userId: string }> {
  const existing = await client.user.findFirst({
    where: { email: { equals: input.email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) throw new Error('A user with that email already exists');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const platform = await client.tenant.findFirst({ where: { isPlatform: true } });
  const tenant =
    platform ??
    (await client.tenant.create({
      data: {
        name: 'Plataforma',
        email: input.email,
        isPlatform: true,
        onboardingCompleted: true,
      },
    }));

  const user = await client.user.create({
    data: {
      tenantId: tenant.id,
      email: input.email,
      password: passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: 'ADMIN',
      isActive: true,
      emailVerified: true,
      mustChangePassword: false,
    },
  });
  return { tenantId: tenant.id, userId: user.id };
}

function readInput(env: NodeJS.ProcessEnv): PlatformAdminInput {
  const names = [
    'PLATFORM_ADMIN_EMAIL',
    'PLATFORM_ADMIN_PASSWORD',
    'PLATFORM_ADMIN_FIRST_NAME',
    'PLATFORM_ADMIN_LAST_NAME',
  ] as const;
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  const password = env.PLATFORM_ADMIN_PASSWORD!;
  if (password.length < 8) {
    throw new Error('PLATFORM_ADMIN_PASSWORD must have at least 8 characters');
  }
  return {
    email: env.PLATFORM_ADMIN_EMAIL!,
    password,
    firstName: env.PLATFORM_ADMIN_FIRST_NAME!,
    lastName: env.PLATFORM_ADMIN_LAST_NAME!,
  };
}

if (require.main === module) {
  let client: PrismaClient | undefined;
  Promise.resolve()
    .then(async () => {
      const input = readInput(process.env);
      client = new PrismaClient();
      const result = await createPlatformAdmin(client, input);
      console.log(JSON.stringify(result));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => client?.$disconnect());
}
