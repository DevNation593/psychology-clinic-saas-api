import { Prisma } from '@prisma/client';

// Fields of a User that are safe to embed in API responses.
// Never return the full User row: it carries the password hash and the FCM token.
export const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatarUrl: true,
  role: true,
  professionalTitle: true,
} satisfies Prisma.UserSelect;
