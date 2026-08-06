import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { logAction } from '../audit/audit.service';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  authenticate,
  requirePermission('setting:read'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }),
);

settingsRouter.put(
  '/',
  authenticate,
  requirePermission('setting:write'),
  validate(z.record(z.string(), z.string())),
  asyncHandler(async (req, res) => {
    const entries = Object.entries(req.body as Record<string, string>);
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } }),
      ),
    );
    await logAction(req, 'MODIFICATION_PARAMETRES', 'Setting', undefined, { cles: entries.map(([k]) => k) });
    res.json({ message: 'Paramètres enregistrés', modifies: entries.length });
  }),
);
