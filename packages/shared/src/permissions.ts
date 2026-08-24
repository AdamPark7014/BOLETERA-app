/**
 * Core permission keys for RBAC → ABAC migration (foundation).
 *
 * These are the first-class authorization atoms stored in `Permission.key`.
 * Role defaults live in `RolePermission`; per-user overrides in `UserPermission`.
 */
export const PermissionKey = {
  EVENTS_READ: 'events.read',
  EVENTS_PUBLISH: 'events.publish',
  ORDERS_REFUND: 'orders.refund',
  TICKETS_SCAN: 'tickets.scan',
  VENUES_EDIT: 'venues.edit',
  REPORTS_READ: 'reports.read',
  FINANCE_EXPORT: 'finance.export',
  PLATFORM_ADMIN: 'platform.admin',
} as const;

export type PermissionKeyValue = (typeof PermissionKey)[keyof typeof PermissionKey];

export const CORE_PERMISSION_KEYS = Object.freeze(
  Object.values(PermissionKey) as PermissionKeyValue[],
);

export const PERMISSION_LABELS: Record<PermissionKeyValue, string> = {
  'events.read': 'View events',
  'events.publish': 'Publish events',
  'orders.refund': 'Refund orders',
  'tickets.scan': 'Scan tickets',
  'venues.edit': 'Edit venues',
  'reports.read': 'View reports',
  'finance.export': 'Export financial data',
  'platform.admin': 'Platform administration',
};
