import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { logAction } from '../audit/audit.service';
import * as service from './backup.service';

export const backupRouter = Router();

backupRouter.get(
  '/',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json(await service.listBackups());
  }),
);

backupRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const backup = await service.createBackup('MANUEL');
    await logAction(req, 'SAUVEGARDE_MANUELLE', 'Backup', backup.id, { fichier: backup.filename });
    res.status(201).json(backup);
  }),
);

backupRouter.get(
  '/:filename/telecharger',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const content = await service.readBackup(req.params.filename);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(content);
  }),
);

backupRouter.post(
  '/restaurer',
  authenticate,
  requireRole('ADMIN'),
  validate(z.object({ filename: z.string().min(3), confirmation: z.literal('RESTAURER') })),
  asyncHandler(async (req, res) => {
    const result = await service.restoreBackup(req.body.filename);
    await logAction(req, 'RESTAURATION_SAUVEGARDE', 'Backup', undefined, { fichier: req.body.filename });
    res.json(result);
  }),
);
