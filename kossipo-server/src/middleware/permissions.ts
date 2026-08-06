import type { Role } from '@prisma/client';

/**
 * Matrice des autorisations. Une permission suit le format "domaine:action".
 * Le caractère "*" accorde l'ensemble du domaine.
 */
export const PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ['*'],
  MANAGER: [
    'order:*', 'table:*', 'product:read', 'product:write', 'payment:*',
    'cash:*', 'stock:*', 'report:read', 'user:read', 'audit:read', 'setting:read',
  ],
  CASHIER: [
    'order:read', 'order:create', 'order:update', 'order:send', 'order:cancel',
    'table:read', 'table:update', 'product:read',
    'payment:create', 'payment:read', 'cash:open', 'cash:close', 'cash:read',
    'stock:read',
  ],
  KITCHEN: ['order:read', 'order:prepare', 'table:read', 'product:read', 'stock:read'],
  BAR: ['order:read', 'order:prepare', 'table:read', 'product:read', 'stock:read'],
};

export function roleHas(role: Role, permission: string): boolean {
  const granted = PERMISSIONS[role] ?? [];
  if (granted.includes('*')) return true;
  if (granted.includes(permission)) return true;
  const [domain] = permission.split(':');
  return granted.includes(`${domain}:*`);
}
