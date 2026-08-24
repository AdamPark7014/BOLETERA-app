/**
 * Core permission catalog and default role → permission mappings.
 * Used by seed.ts and kept in sync with @boletera/shared PermissionKey.
 */
import { UserRole } from '@prisma/client';
import { CORE_PERMISSION_KEYS, PermissionKey } from '@boletera/shared';
import type { PrismaClient } from '@prisma/client';

const ALL = [...CORE_PERMISSION_KEYS];

export const PERMISSION_DEFINITIONS: { key: string; description: string }[] = [
  { key: PermissionKey.EVENTS_READ, description: 'View events and catalog' },
  { key: PermissionKey.EVENTS_PUBLISH, description: 'Publish events to sale' },
  { key: PermissionKey.ORDERS_REFUND, description: 'Issue order refunds' },
  { key: PermissionKey.TICKETS_SCAN, description: 'Scan tickets at access control' },
  { key: PermissionKey.VENUES_EDIT, description: 'Edit venue layouts and maps' },
  { key: PermissionKey.REPORTS_READ, description: 'View sales and operational reports' },
  { key: PermissionKey.FINANCE_EXPORT, description: 'Export financial data' },
  { key: PermissionKey.PLATFORM_ADMIN, description: 'Platform-wide superuser operations' },
];

/**
 * Default permission sets per UserRole.
 * Mirrors existing @Roles() usage and apps/admin/lib/permissions.ts capabilities.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly string[]> = {
  [UserRole.CUSTOMER]: [],
  [UserRole.SCANNER]: [PermissionKey.TICKETS_SCAN],
  [UserRole.TAQUILLA]: [PermissionKey.EVENTS_READ, PermissionKey.TICKETS_SCAN],
  [UserRole.TAQUILLA_SUPERVISOR]: [
    PermissionKey.EVENTS_READ,
    PermissionKey.TICKETS_SCAN,
    PermissionKey.ORDERS_REFUND,
  ],
  [UserRole.TAQUILLA_ADMIN]: [
    PermissionKey.EVENTS_READ,
    PermissionKey.TICKETS_SCAN,
    PermissionKey.ORDERS_REFUND,
    PermissionKey.REPORTS_READ,
  ],
  [UserRole.ARTIST]: [PermissionKey.EVENTS_READ],
  [UserRole.VENUE_MANAGER]: [
    PermissionKey.EVENTS_READ,
    PermissionKey.VENUES_EDIT,
    PermissionKey.REPORTS_READ,
    PermissionKey.TICKETS_SCAN,
  ],
  [UserRole.PROMOTER]: [
    PermissionKey.EVENTS_READ,
    PermissionKey.EVENTS_PUBLISH,
    PermissionKey.REPORTS_READ,
    PermissionKey.ORDERS_REFUND,
  ],
  [UserRole.ADMIN]: [
    PermissionKey.EVENTS_READ,
    PermissionKey.EVENTS_PUBLISH,
    PermissionKey.ORDERS_REFUND,
    PermissionKey.TICKETS_SCAN,
    PermissionKey.VENUES_EDIT,
    PermissionKey.REPORTS_READ,
    PermissionKey.FINANCE_EXPORT,
  ],
  [UserRole.SUPER_ADMIN]: ALL,
  [UserRole.FINANCE]: [
    PermissionKey.EVENTS_READ,
    PermissionKey.ORDERS_REFUND,
    PermissionKey.REPORTS_READ,
    PermissionKey.FINANCE_EXPORT,
  ],
  [UserRole.MARKETING]: [PermissionKey.EVENTS_READ, PermissionKey.REPORTS_READ],
  [UserRole.SUPPORT]: [
    PermissionKey.EVENTS_READ,
    PermissionKey.ORDERS_REFUND,
    PermissionKey.REPORTS_READ,
  ],
  [UserRole.AUDITOR]: [PermissionKey.REPORTS_READ, PermissionKey.FINANCE_EXPORT],
  [UserRole.AFFILIATE]: [PermissionKey.EVENTS_READ],
};

export async function seedPermissions(prisma: PrismaClient): Promise<void> {
  const permissionIds = new Map<string, string>();

  for (const def of PERMISSION_DEFINITIONS) {
    const row = await prisma.permission.upsert({
      where: { key: def.key },
      update: { description: def.description },
      create: { key: def.key, description: def.description },
    });
    permissionIds.set(def.key, row.id);
  }

  for (const [role, keys] of Object.entries(ROLE_DEFAULT_PERMISSIONS) as [UserRole, readonly string[]][]) {
    for (const key of keys) {
      const permissionId = permissionIds.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role, permissionId } },
        update: {},
        create: { role, permissionId },
      });
    }
  }
}
