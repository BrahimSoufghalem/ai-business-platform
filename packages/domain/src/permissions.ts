export type MembershipRole = 'owner' | 'manager' | 'agent';

export type Permission =
  | 'tenant:manage'
  | 'members:manage'
  | 'catalog:read'
  | 'catalog:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'orders:read'
  | 'orders:write'
  | 'conversations:read'
  | 'conversations:manage'
  | 'configuration:read'
  | 'configuration:manage'
  | 'audit:read';

const allPermissions: readonly Permission[] = [
  'tenant:manage',
  'members:manage',
  'catalog:read',
  'catalog:write',
  'inventory:read',
  'inventory:write',
  'orders:read',
  'orders:write',
  'conversations:read',
  'conversations:manage',
  'configuration:read',
  'configuration:manage',
  'audit:read',
];

const permissionsByRole: Record<MembershipRole, ReadonlySet<Permission>> = {
  owner: new Set(allPermissions),
  manager: new Set([
    'members:manage',
    'catalog:read',
    'catalog:write',
    'inventory:read',
    'inventory:write',
    'orders:read',
    'orders:write',
    'conversations:read',
    'conversations:manage',
    'configuration:read',
    'configuration:manage',
    'audit:read',
  ]),
  agent: new Set([
    'catalog:read',
    'inventory:read',
    'orders:read',
    'orders:write',
    'conversations:read',
    'conversations:manage',
    'configuration:read',
  ]),
};

export class PermissionDeniedError extends Error {
  constructor(role: MembershipRole, permission: Permission) {
    super(`Role ${role} does not have permission ${permission}.`);
    this.name = 'PermissionDeniedError';
  }
}

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return permissionsByRole[role].has(permission);
}

export function requirePermission(role: MembershipRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new PermissionDeniedError(role, permission);
  }
}
