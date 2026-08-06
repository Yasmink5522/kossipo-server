import { Router } from 'express';
import { z } from 'zod';
import { StockMovementType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { logAction } from '../audit/audit.service';
import { emit } from '../../realtime/socket';
import { EVENTS, ROOMS } from '../../realtime/events';
import * as service from './stock.service';

export const stockRouter = Router();

stockRouter.get(
  '/',
  authenticate,
  requirePermission('stock:read'),
  asyncHandler(async (_req, res) => {
    const items = await prisma.stockItem.findMany({
      where: { active: true },
      include: { category: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
    res.json(
      items.map((i) => ({
        id: i.id,
        nom: i.name,
        categorie: i.category.name,
        categorieId: i.categoryId,
        unite: i.unit,
        quantite: i.quantity,
        seuil: i.minQuantity,
        coutUnitaire: i.unitCost,
        valeur: Math.round(i.quantity * i.unitCost),
        alerte: i.quantity <= i.minQuantity,
        majLe: i.updatedAt,
      })),
    );
  }),
);

stockRouter.get(
  '/categories',
  authenticate,
  requirePermission('stock:read'),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.stockCategory.findMany({ orderBy: { sortOrder: 'asc' } }));
  }),
);

stockRouter.get(
  '/alertes',
  authenticate,
  requirePermission('stock:read'),
  asyncHandler(async (_req, res) => {
    const items = await service.lowStockItems();
    res.json(
      items.map((i) => ({
        id: i.id,
        nom: i.name,
        categorie: i.category.name,
        quantite: i.quantity,
        seuil: i.minQuantity,
        unite: i.unit,
      })),
    );
  }),
);

stockRouter.get(
  '/valorisation',
  authenticate,
  requirePermission('stock:read'),
  asyncHandler(async (_req, res) => {
    res.json(await service.stockValuation());
  }),
);

stockRouter.get(
  '/mouvements',
  authenticate,
  requirePermission('stock:read'),
  asyncHandler(async (req, res) => {
    const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined;
    res.json(
      await prisma.stockMovement.findMany({
        where: itemId ? { itemId } : {},
        include: {
          item: { select: { name: true, unit: true } },
          user: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }),
);

const itemSchema = z.object({
  name: z.string().min(2),
  categoryId: z.string().uuid(),
  unit: z.string().min(1).default('u'),
  quantity: z.number().min(0).default(0),
  minQuantity: z.number().min(0).default(0),
  unitCost: z.number().int().min(0).default(0),
});

stockRouter.post(
  '/',
  authenticate,
  requirePermission('stock:write'),
  validate(itemSchema),
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.create({ data: req.body });
    await logAction(req, 'CREATION_ARTICLE_STOCK', 'StockItem', item.id, { nom: item.name });
    emit(EVENTS.STOCK_UPDATED, item, [ROOMS.ADMIN]);
    res.status(201).json(item);
  }),
);

stockRouter.patch(
  '/:id',
  authenticate,
  requirePermission('stock:write'),
  validate(itemSchema.partial().omit({ quantity: true })),
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.update({ where: { id: req.params.id }, data: req.body });
    await logAction(req, 'MODIFICATION_ARTICLE_STOCK', 'StockItem', item.id, req.body);
    emit(EVENTS.STOCK_UPDATED, item, [ROOMS.ADMIN]);
    res.json(item);
  }),
);

const movementSchema = z.object({
  itemId: z.string().uuid(),
  type: z.nativeEnum(StockMovementType),
  quantity: z.number().min(0),
  unitCost: z.number().int().min(0).optional(),
  reason: z.string().max(200).optional(),
});

/** Entrée, sortie, perte ou comptage d'inventaire. */
stockRouter.post(
  '/mouvement',
  authenticate,
  requirePermission('stock:write'),
  validate(movementSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof movementSchema>;
    const result = await prisma.$transaction((tx) =>
      service.applyMovement(tx, { ...body, userId: req.auth!.sub }),
    );
    await logAction(req, `STOCK_${body.type}`, 'StockItem', body.itemId, {
      quantite: body.quantity,
      motif: body.reason,
    });
    emit(EVENTS.STOCK_UPDATED, result.item, [ROOMS.ADMIN, ROOMS.POS]);
    if (result.alert) {
      service.broadcastStockAlerts([
        { nom: result.item.name, quantite: result.item.quantity, seuil: result.item.minQuantity },
      ]);
    }
    res.status(201).json(result);
  }),
);

/** Inventaire complet : la quantité transmise est le comptage physique réel. */
stockRouter.post(
  '/inventaire',
  authenticate,
  requirePermission('stock:write'),
  validate(
    z.object({
      lignes: z.array(z.object({ itemId: z.string().uuid(), quantite: z.number().min(0) })).min(1),
      note: z.string().max(200).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { lignes, note } = req.body as { lignes: { itemId: string; quantite: number }[]; note?: string };
    const results = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const ligne of lignes) {
        out.push(
          await service.applyMovement(tx, {
            itemId: ligne.itemId,
            type: 'INVENTAIRE',
            quantity: ligne.quantite,
            reason: note ?? 'Inventaire',
            userId: req.auth!.sub,
          }),
        );
      }
      return out;
    });
    await logAction(req, 'INVENTAIRE', 'StockItem', undefined, { lignes: lignes.length });
    emit(EVENTS.STOCK_UPDATED, { inventaire: true }, [ROOMS.ADMIN, ROOMS.POS]);
    res.json({ misAJour: results.length });
  }),
);

/** Fiche technique : lie un produit vendu à ses ingrédients. */
stockRouter.put(
  '/fiche-technique/:productId',
  authenticate,
  requirePermission('stock:write'),
  validate(
    z.object({
      lignes: z.array(z.object({ stockItemId: z.string().uuid(), quantity: z.number().positive() })),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { lignes } = req.body as { lignes: { stockItemId: string; quantity: number }[] };
    await prisma.$transaction(async (tx) => {
      await tx.recipeLine.deleteMany({ where: { productId } });
      if (lignes.length) {
        await tx.recipeLine.createMany({ data: lignes.map((l) => ({ ...l, productId })) });
      }
    });
    await logAction(req, 'MODIFICATION_FICHE_TECHNIQUE', 'Product', productId, { lignes: lignes.length });
    res.json({ message: 'Fiche technique enregistrée' });
  }),
);

stockRouter.get(
  '/fiche-technique/:productId',
  authenticate,
  requirePermission('stock:read'),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.recipeLine.findMany({
        where: { productId: req.params.productId },
        include: { stockItem: { select: { name: true, unit: true } } },
      }),
    );
  }),
);
