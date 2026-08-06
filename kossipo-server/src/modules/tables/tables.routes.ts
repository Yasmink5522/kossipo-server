import { Router } from 'express';
import { z } from 'zod';
import { TableStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { logAction } from '../audit/audit.service';
import { emit } from '../../realtime/socket';
import { EVENTS } from '../../realtime/events';

export const tablesRouter = Router();

/** Plan de salle complet : zones, tables, et commande ouverte de chaque table. */
tablesRouter.get(
  '/plan',
  authenticate,
  requirePermission('table:read'),
  asyncHandler(async (_req, res) => {
    const zones = await prisma.zone.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        tables: {
          where: { active: true },
          orderBy: { number: 'asc' },
          include: {
            orders: {
              where: { status: { in: ['OUVERTE', 'ENVOYEE', 'EN_PREPARATION', 'SERVIE'] } },
              select: { id: true, number: true, total: true, status: true, openedAt: true, guests: true },
              orderBy: { openedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    res.json(
      zones.map((zone) => ({
        id: zone.id,
        code: zone.code,
        nom: zone.name,
        couleur: zone.color,
        boissonPrixLibre: zone.freeDrinkPrice,
        tables: zone.tables.map((t) => ({
          id: t.id,
          numero: t.number,
          libelle: t.label,
          places: t.seats,
          x: t.posX,
          y: t.posY,
          statut: t.status,
          commande: t.orders[0] ?? null,
        })),
      })),
    );
  }),
);

tablesRouter.get(
  '/zones',
  authenticate,
  requirePermission('table:read'),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.zone.findMany({ orderBy: { sortOrder: 'asc' } }));
  }),
);

const createSchema = z.object({
  zoneId: z.string().uuid(),
  number: z.number().int().positive(),
  label: z.string().min(1),
  seats: z.number().int().positive().default(4),
  posX: z.number().int().default(0),
  posY: z.number().int().default(0),
});

tablesRouter.post(
  '/',
  authenticate,
  requirePermission('table:write'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.create({ data: req.body });
    await logAction(req, 'CREATION_TABLE', 'RestaurantTable', table.id);
    emit(EVENTS.TABLE_UPDATED, table);
    res.status(201).json(table);
  }),
);

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  seats: z.number().int().positive().optional(),
  posX: z.number().int().optional(),
  posY: z.number().int().optional(),
  status: z.nativeEnum(TableStatus).optional(),
  active: z.boolean().optional(),
});

tablesRouter.patch(
  '/:id',
  authenticate,
  requirePermission('table:update'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.update({ where: { id: req.params.id }, data: req.body });
    await logAction(req, 'MODIFICATION_TABLE', 'RestaurantTable', table.id, req.body);
    emit(EVENTS.TABLE_UPDATED, table);
    res.json(table);
  }),
);

tablesRouter.delete(
  '/:id',
  authenticate,
  requirePermission('table:write'),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    await logAction(req, 'SUPPRESSION_TABLE', 'RestaurantTable', table.id);
    emit(EVENTS.TABLE_UPDATED, table);
    res.json({ message: 'Table retirée du plan' });
  }),
);
