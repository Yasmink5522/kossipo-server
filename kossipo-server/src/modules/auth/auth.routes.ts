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
