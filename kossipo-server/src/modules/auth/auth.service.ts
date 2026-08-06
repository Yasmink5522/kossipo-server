import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/http-error';
import { signAccessToken, signRefreshToken, type AuthPayload } from '../../middleware/auth';
import { PERMISSIONS } from '../../middleware/permissions';

const ROUNDS = 10;

export async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, ROUNDS);
}

function toPayload(user: User): AuthPayload {
  return { sub: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

export function buildSession(user: User) {
  const payload = toPayload(user);
  return {
    token: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    utilisateur: {
      id: user.id,
      nom: user.fullName,
      identifiant: user.username,
      role: user.role,
      permissions: PERMISSIONS[user.role],
    },
  };
}

export async function loginWithPassword(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase().trim() } });
  if (!user || !user.active || !user.passwordHash) {
    throw HttpError.unauthorized('Identifiant ou mot de passe incorrect');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw HttpError.unauthorized('Identifiant ou mot de passe incorrect');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return buildSession(user);
}

/**
 * Connexion par code PIN. Le PIN n'étant pas unique en base (haché),
 * on compare le candidat aux PIN actifs. Le nombre d'utilisateurs d'un
 * restaurant reste très faible, l'opération est instantanée.
 */
export async function loginWithPin(pin: string) {
  const users = await prisma.user.findMany({ where: { active: true, pinHash: { not: null } } });
  for (const user of users) {
    if (user.pinHash && (await bcrypt.compare(pin, user.pinHash))) {
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return buildSession(user);
    }
  }
  throw HttpError.unauthorized('Code PIN incorrect');
}

export async function refreshSession(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw HttpError.unauthorized('Compte désactivé');
  return buildSession(user);
}

export async function changeOwnSecrets(userId: string, params: { password?: string; pin?: string }) {
  const data: { passwordHash?: string; pinHash?: string } = {};
  if (params.password) data.passwordHash = await hashSecret(params.password);
  if (params.pin) data.pinHash = await hashSecret(params.pin);
  if (Object.keys(data).length === 0) throw HttpError.badRequest('Aucune modification demandée');
  await prisma.user.update({ where: { id: userId }, data });
}
