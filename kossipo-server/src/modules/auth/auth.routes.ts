import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { authenticate, verifyToken } from '../../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { HttpError } from '../../utils/http-error';
import { logAction } from '../audit/audit.service';
import * as service from './auth.service';

export const authRouter = Router();

/** Protection contre le bourrage d'identifiants. */
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives. Réessayez dans 5 minutes.', code: 'TROP_DE_TENTATIVES' },
});

const passwordSchema = z.object({
  username: z.string().min(2, 'Identifiant trop court'),
  password: z.string().min(4, 'Mot de passe trop court'),
});

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, 'Le code PIN comporte 4 à 8 chiffres'),
});

authRouter.post(
  '/login',
  loginLimiter,
  validate(passwordSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as z.infer<typeof passwordSchema>;
    const session = await service.loginWithPassword(username, password);
    await logAction(req, 'CONNEXION_MOT_DE_PASSE', 'User', session.utilisateur.id);
    res.json(session);
  }),
);

authRouter.post(
  '/login-pin',
  loginLimiter,
  validate(pinSchema),
  asyncHandler(async (req, res) => {
    const { pin } = req.body as z.infer<typeof pinSchema>;
    const session = await service.loginWithPin(pin);
    await logAction(req, 'CONNEXION_PIN', 'User', session.utilisateur.id);
    res.json(session);
  }),
);

authRouter.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    const payload = verifyToken(req.body.refreshToken);
    if (payload.typ !== 'refresh') throw HttpError.unauthorized('Jeton de rafraîchissement attendu');
    res.json(await service.refreshSession(payload.sub));
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(req.auth);
  }),
);

authRouter.post(
  '/change-secrets',
  authenticate,
  validate(
    z.object({
      password: z.string().min(6).optional(),
      pin: z.string().regex(/^\d{4,8}$/).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    await service.changeOwnSecrets(req.auth!.sub, req.body);
    await logAction(req, 'MODIFICATION_IDENTIFIANTS', 'User', req.auth!.sub);
    res.json({ message: 'Identifiants mis à jour' });
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await logAction(req, 'DECONNEXION', 'User', req.auth!.sub);
    res.json({ message: 'Déconnecté' });
  }),
);

Le jeu. 6 août 2026 à 13:05, Kouassi Yasmine <yasmink5522@gmail.com> a écrit :
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
