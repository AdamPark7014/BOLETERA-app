import type { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: UserRole;
  organizationId?: string;
  authSource?: 'bearer' | 'cookie';
  sid?: string;
}

export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  user?: AuthenticatedUser;
  ip?: string;
  socket: { remoteAddress?: string };
}

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}
