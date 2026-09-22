import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PermissionDeniedError,
  requirePermission,
  type MembershipRole,
  type Permission,
  type TenantId,
} from '@ai-business/domain';
import type { TenantTransaction } from '@ai-business/db';

export async function authorizeTenantPermission(
  transaction: TenantTransaction,
  tenantId: TenantId,
  permission: Permission,
): Promise<MembershipRole> {
  const [membership] = await transaction<{ role: MembershipRole | null }[]>`
    select app_current_membership_role(${tenantId}) as role
  `;
  if (!membership?.role) throw new NotFoundException('Tenant not found.');

  try {
    requirePermission(membership.role, permission);
    return membership.role;
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      throw new ForbiddenException(`The active role cannot perform ${permission}.`);
    }
    throw error;
  }
}
