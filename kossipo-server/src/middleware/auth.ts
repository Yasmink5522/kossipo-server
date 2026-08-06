import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { HttpError } from '../utils/http-error';
import { roleHas } from './permissions';

export interface AuthPayload {
  sub: string;
  username: string;
  fullName: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as SignOptions);
}

export function signRefreshToken(payload: AuthPayload): string {
  return jwt.sign({ ...payload, type: 'refresh' }, env.jwtSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  } as SignOptions);
}

export function verifyToken(token: string): AuthPayload & { type?: string } {
  try {
    return jwt.verify(token, env.jwtSecret) as AuthPayload & { type?: string };
  } catch {
    throw HttpError.unauthorized('Session expirée, veuillez vous reconnecter');
  }
}

/** Exige un jeton valide. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(HttpError.unauthorized());
  }

  const payload = verifyToken(header.slice(7));
  if (payload.type === 'refresh') {
    return next(HttpError.unauthorized('Jeton de rafraîchissement non utilisable ici'));
  }

  req.auth = {
    sub: payload.sub,
    username: payload.username,
    fullName: payload.fullName,
    role: payload.role,
  };
  next();
}

/** Exige une permission précise. */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(HttpError.unauthorized());
    if (!roleHas(req.auth.role, permission)) {
      return next(HttpError.forbidden(`Permission requise : ${permission}`));
    }
    next();
  };
}

/** Exige l'un des rôles listés. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(HttpError.unauthorized());
    if (!roles.includes(req.auth.role)) return next(HttpError.forbidden());
    next();
  };
}
