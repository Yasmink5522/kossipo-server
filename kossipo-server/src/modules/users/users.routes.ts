import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { HttpError } from '../../utils/http-error';
import { hashSecret } from '../auth/auth.service';
import { logAction } from '../audit/audit.service';
import { connectedUsers } from '../../realtime/socket';

export const usersRouter = Router();

const publicSelect = {
  id: true,
  fullName: true,
  username: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

const createSchema = z.object({
  fullName: z.string().min(3, 'Nom complet requis'),
  username: z.string().min(3).regex(/^[a-z0-9._-]+$/i, 'Lettres, chiffres, . _ - uniquement'),
  role: z.nativeEnum(Role),
  password: z.string().min(6).optional(),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
}).refine((v) => v.password || v.pin, { message: 'Mot de passe ou code PIN obligatoire' });

const updateSchema = z.object({
  fullName: z.string().min(3).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});

usersRouter.get(
  '/',
  authenticate,
  requirePermission('user:read'),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.user.findMany({ select: publicSelect, orderBy: { fullName: 'asc' } }));
  }),
);

usersRouter.get(
  '/connectes',
  authenticate,
  requirePermission('user:read'),
  asyncHandler(async (_req, res) => {
    res.json(connectedUsers());
  }),
);

usersRouter.post(
  '/',
  authenticate,
  requirePermission('user:write'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        username: body.username.toLowerCase(),
        role: body.role,
        passwordHash: body.password ? await hashSecret(body.password) : null,
        pinHash: body.pin ? await hashSecret(body.pin) : null,
      },
      select: publicSelect,
    });
    await logAction(req, 'CREATION_UTILISATEUR', 'User', user.id, { role: user.role });
    res.status(201).json(user);
  }),
);

usersRouter.patch(
  '/:id',
  authenticate,
  requirePermission('user:write'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateSchema>;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(body.fullName ? { fullName: body.fullName } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.password ? { passwordHash: await hashSecret(body.password) } : {}),
        ...(body.pin ? { pinHash: await hashSecret(body.pin) } : {}),
      },
      select: publicSelect,
    });
    await logAction(req, 'MODIFICATION_UTILISATEUR', 'User', user.id);
    res.json(user);
  }),
);

usersRouter.delete(
  '/:id',
  authenticate,
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.auth!.sub) {
      throw HttpError.badRequest('Vous ne pouvez pas désactiver votre propre compte');
    }
    // Désactivation plutôt que suppression : l'historique des ventes doit rester intact.
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { active: false },
      select: publicSelect,
    });
    await logAction(req, 'DESACTIVATION_UTILISATEUR', 'User', user.id);
    res.json(user);
  }),
);
