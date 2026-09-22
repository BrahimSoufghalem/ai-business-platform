import { describe, expect, it } from 'vitest';
import { hasPermission, PermissionDeniedError, requirePermission } from '../src/permissions.js';

describe('role permissions', () => {
  it('allows an owner to manage the tenant', () => {
    expect(hasPermission('owner', 'tenant:manage')).toBe(true);
  });

  it('allows an agent to work with orders but not inventory writes', () => {
    expect(hasPermission('agent', 'orders:write')).toBe(true);
    expect(hasPermission('agent', 'inventory:write')).toBe(false);
  });

  it('fails closed for a missing permission', () => {
    expect(() => requirePermission('manager', 'tenant:manage')).toThrow(PermissionDeniedError);
  });

  it('lets agents read published configuration but only managers can publish it', () => {
    expect(hasPermission('agent', 'configuration:read')).toBe(true);
    expect(hasPermission('agent', 'configuration:manage')).toBe(false);
    expect(hasPermission('manager', 'configuration:manage')).toBe(true);
  });
});
