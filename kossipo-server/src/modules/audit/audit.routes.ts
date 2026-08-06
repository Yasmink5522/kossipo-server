import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';

export const auditRouter = Router();

const querySchema = z.object({
  entity: z.string().optional(),
  userId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

auditRouter.get(
  '/',
  authenticate,
  requirePermission('audit:read'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { entity, userId, take, skip } = req.query as unknown as z.infer<typeof querySchema>;
    const where = { ...(entity ? { entity } : {}), ...(userId ? { userId } : {}) };
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { user: { select: { fullName: true, role: true } } },
      }),
    ]);
    res.json({ total, entries });
  }),
);
