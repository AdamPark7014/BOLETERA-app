import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CORE_PERMISSION_KEYS } from '@boletera/shared';
import { PrismaService } from '../prisma/prisma.service';
import { invalidateUserAuthCache } from './jwt.strategy';

const DEFAULT_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 5_000;

/** TTL mirrors auth snapshot cache — permission revocations propagate within this window. */
export const PERMISSIONS_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.PERMISSIONS_CACHE_TTL_MS ?? process.env.AUTH_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
})();

interface PermissionCacheEntry {
  keys: Set<string>;
  expiresAt: number;
}

const permissionCache = new Map<string, PermissionCacheEntry>();

function cacheKey(userId: string, role: string): string {
  return `${userId}:${role}`;
}

function pruneExpired(now: number): void {
  for (const [key, value] of permissionCache) {
    if (value.expiresAt <= now) permissionCache.delete(key);
  }
  if (permissionCache.size >= MAX_CACHE_ENTRIES) permissionCache.clear();
}

/** Drop cached permissions for a user (call after role change or override mutation). */
export function invalidateUserPermissionsCache(userId: string): void {
  for (const key of permissionCache.keys()) {
    if (key.startsWith(`${userId}:`)) permissionCache.delete(key);
  }
  invalidateUserAuthCache(userId);
}

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  /** Effective permission keys: role defaults ± user overrides. */
  async effectivePermissions(userId: string, role: string): Promise<Set<string>> {
    if (role === UserRole.SUPER_ADMIN) {
      return new Set(CORE_PERMISSION_KEYS);
    }

    const now = Date.now();
    const key = cacheKey(userId, role);
    const cached = permissionCache.get(key);
    if (cached && cached.expiresAt > now) return cached.keys;

    const [roleRows, userRows] = await Promise.all([
      this.prisma.rolePermission.findMany({
        where: { role: role as UserRole },
        select: { permission: { select: { key: true } } },
      }),
      this.prisma.userPermission.findMany({
        where: { userId },
        select: { granted: true, permission: { select: { key: true } } },
      }),
    ]);

    const keys = new Set(roleRows.map((row) => row.permission.key));
    for (const override of userRows) {
      if (override.granted) keys.add(override.permission.key);
      else keys.delete(override.permission.key);
    }

    if (permissionCache.size >= MAX_CACHE_ENTRIES) pruneExpired(now);
    permissionCache.set(key, { keys, expiresAt: now + PERMISSIONS_CACHE_TTL_MS });
    return keys;
  }

  async hasPermission(userId: string, role: string, permission: string): Promise<boolean> {
    const keys = await this.effectivePermissions(userId, role);
    return keys.has(permission);
  }

  async hasAllPermissions(userId: string, role: string, required: string[]): Promise<boolean> {
    if (!required.length) return true;
    const keys = await this.effectivePermissions(userId, role);
    return required.every((perm) => keys.has(perm));
  }
}
