import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { HttpError } from '../../utils/http-error';
import { logAction } from '../audit/audit.service';
import { emit } from '../../realtime/socket';
import { EVENTS, ROOMS } from '../../realtime/events';
import { broadcastStockAlerts } from '../stock/stock.service';
import { buildTicket, type TicketKind } from './tickets';
import * as service from './orders.service';

export const ordersRouter = Router();

/** Notifie tous les postes concernés d'un changement de commande. */
function broadcastOrder(event: (typeof EVENTS)[keyof typeof EVENTS], order: unknown) {
  emit(event, order);
  emit(EVENTS.DASHBOARD_REFRESH, { at: new Date().toISOString() }, [ROOMS.ADMIN]);
}

ordersRouter.get(
  '/ouvertes',
  authenticate,
  requirePermission('order:read'),
  asyncHandler(async (_req, res) => {
    res.json(await service.openOrders());
  }),
);

ordersRouter.get(
  '/production/:destination',
  authenticate,
  requirePermission('order:read'),
  asyncHandler(async (req, res) => {
    const destination = req.params.destination.toUpperCase();
    if (destination !== 'KITCHEN' && destination !== 'BAR') {
      throw HttpError.badRequest('Destination attendue : KITCHEN ou BAR');
    }
    res.json(await service.productionQueue(destination));
  }),
);

const historySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

ordersRouter.get(
  '/historique',
  authenticate,
  requirePermission('order:read'),
  validate(historySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof historySchema>;
    const where = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.from || q.to
        ? {
            openedAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999`) } : {}),
            },
          }
        : {}),
    };
    const [total, commandes] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: service.ORDER_INCLUDE,
        orderBy: { openedAt: 'desc' },
        take: q.take,
        skip: q.skip,
      }),
    ]);
    res.json({ total, commandes });
  }),
);

ordersRouter.get(
  '/:id',
  authenticate,
  requirePermission('order:read'),
  asyncHandler(async (req, res) => {
    res.json(await service.getOrder(req.params.id));
  }),
);

ordersRouter.post(
  '/',
  authenticate,
  requirePermission('order:create'),
  validate(
    z.object({
      tableId: z.string().uuid(),
      guests: z.number().int().min(1).max(50).default(1),
      note: z.string().max(300).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await service.createOrder({ ...req.body, userId: req.auth!.sub });
    await logAction(req, 'OUVERTURE_COMMANDE', 'Order', order.id, { numero: order.number });
    broadcastOrder(EVENTS.ORDER_CREATED, order);
    emit(EVENTS.TABLE_UPDATED, { id: order.tableId, status: 'OCCUPEE' });
    res.status(201).json(order);
  }),
);

const itemsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        unitPrice: z.number().int().min(0).optional(),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1),
});

ordersRouter.post(
  '/:id/items',
  authenticate,
  requirePermission('order:update'),
  validate(itemsSchema),
  asyncHandler(async (req, res) => {
    const order = await service.addItems(req.params.id, req.body.items);
    await logAction(req, 'AJOUT_ARTICLES', 'Order', order.id, { lignes: req.body.items.length });
    broadcastOrder(EVENTS.ORDER_UPDATED, order);
    res.json(order);
  }),
);

ordersRouter.patch(
  '/:id/items/:itemId',
  authenticate,
  requirePermission('order:update'),
  validate(
    z.object({
      quantity: z.number().int().min(1).optional(),
      unitPrice: z.number().int().min(0).optional(),
      note: z.string().max(200).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await service.updateItem(req.params.id, req.params.itemId, req.body);
    await logAction(req, 'MODIFICATION_LIGNE', 'Order', order.id, { itemId: req.params.itemId, ...req.body });
    broadcastOrder(EVENTS.ORDER_UPDATED, order);
    res.json(order);
  }),
);

ordersRouter.delete(
  '/:id/items/:itemId',
  authenticate,
  requirePermission('order:update'),
  asyncHandler(async (req, res) => {
    const reason = typeof req.query.motif === 'string' ? req.query.motif : undefined;
    const order = await service.removeItem(req.params.id, req.params.itemId, reason);
    await logAction(req, 'SUPPRESSION_LIGNE', 'Order', order.id, { itemId: req.params.itemId, motif: reason });
    broadcastOrder(EVENTS.ORDER_UPDATED, order);
    res.json(order);
  }),
);

ordersRouter.post(
  '/:id/envoyer',
  authenticate,
  requirePermission('order:send'),
  asyncHandler(async (req, res) => {
    const { order, sentItems, alerts } = await service.sendOrder(req.params.id, req.auth!.sub);

    const kitchenIds = sentItems.filter((i) => i.destination === 'KITCHEN').map((i) => i.id);
    const barIds = sentItems.filter((i) => i.destination === 'BAR').map((i) => i.id);

    const tickets = [];
    if (kitchenIds.length) tickets.push(await buildTicket(order, 'CUISINE', { onlyItemIds: kitchenIds }));
    if (barIds.length) tickets.push(await buildTicket(order, 'BAR', { onlyItemIds: barIds }));

    await logAction(req, 'ENVOI_COMMANDE', 'Order', order.id, { lignes: sentItems.length });
    broadcastOrder(EVENTS.ORDER_SENT, order);
    if (kitchenIds.length) emit(EVENTS.ORDER_SENT, order, [ROOMS.KITCHEN]);
    if (barIds.length) emit(EVENTS.ORDER_SENT, order, [ROOMS.BAR]);
    broadcastStockAlerts(alerts);

    res.json({ commande: order, tickets, alertesStock: alerts });
  }),
);

ordersRouter.post(
  '/:id/statut-lignes',
  authenticate,
  requirePermission('order:prepare'),
  validate(
    z.object({
      itemIds: z.array(z.string().uuid()).min(1),
      status: z.enum(['EN_PREPARATION', 'PRET', 'SERVI']),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await service.markItemsStatus(req.params.id, req.body.itemIds, req.body.status);
    await logAction(req, 'STATUT_PRODUCTION', 'Order', order.id, req.body);
    emit(EVENTS.ITEM_STATUS, order);
    broadcastOrder(EVENTS.ORDER_UPDATED, order);
    res.json(order);
  }),
);

ordersRouter.post(
  '/:id/annuler',
  authenticate,
  requirePermission('order:cancel'),
  validate(z.object({ motif: z.string().min(3, 'Motif obligatoire') })),
  asyncHandler(async (req, res) => {
    const order = await service.cancelOrder(req.params.id, req.body.motif);
    await logAction(req, 'ANNULATION_COMMANDE', 'Order', order.id, { motif: req.body.motif });
    broadcastOrder(EVENTS.ORDER_CANCELLED, order);
    emit(EVENTS.TABLE_UPDATED, { id: order.tableId, status: 'LIBRE' });
    res.json(order);
  }),
);

ordersRouter.post(
  '/:id/deplacer',
  authenticate,
  requirePermission('order:update'),
  validate(z.object({ tableId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const order = await service.moveOrder(req.params.id, req.body.tableId);
    await logAction(req, 'DEPLACEMENT_TABLE', 'Order', order.id, { versTable: req.body.tableId });
    broadcastOrder(EVENTS.ORDER_UPDATED, order);
    emit(EVENTS.TABLE_UPDATED, order.table);
    res.json(order);
  }),
);

ordersRouter.post(
  '/:id/fusionner',
  authenticate,
  requirePermission('order:update'),
  validate(z.object({ sourceOrderId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const order = await service.mergeOrders(req.body.sourceOrderId, req.params.id);
    await logAction(req, 'FUSION_COMMANDES', 'Order', order.id, { source: req.body.sourceOrderId });
    broadcastOrder(EVENTS.ORDER_UPDATED, order);
    res.json(order);
  }),
);

ordersRouter.post(
  '/:id/separer',
  authenticate,
  requirePermission('order:update'),
  validate(
    z.object({
      parts: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().int().min(1) })).min(1),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await service.splitOrder(req.params.id, req.body.parts, req.auth!.sub);
    await logAction(req, 'SEPARATION_ADDITION', 'Order', req.params.id, {
      nouvelle: result.nouvelle.number,
    });
    broadcastOrder(EVENTS.ORDER_UPDATED, result.source);
    broadcastOrder(EVENTS.ORDER_CREATED, result.nouvelle);
    res.json(result);
  }),
);

ordersRouter.post(
  '/:id/remise',
  authenticate,
  requirePermission('order:discount'),
  validate(z.object({ remise: z.number().int().min(0) })),
  asyncHandler(async (req, res) => {
    const order = await service.applyDiscount(req.params.id, req.body.remise);
    await logAction(req, 'APPLICATION_REMISE', 'Order', order.id, { remise: req.body.remise });
    broadcastOrder(EVENTS.ORDER_UPDATED, order);
    res.json(order);
  }),
);

ordersRouter.get(
  '/:id/ticket/:type',
  authenticate,
  requirePermission('order:read'),
  asyncHandler(async (req, res) => {
    const type = req.params.type.toUpperCase() as TicketKind;
    const allowed: TicketKind[] = ['CUISINE', 'BAR', 'RECU', 'FACTURE', 'PRE_ADDITION'];
    if (!allowed.includes(type)) throw HttpError.badRequest('Type de ticket inconnu');
    const order = await service.getOrder(req.params.id);
    res.json(await buildTicket(order, type));
  }),
);
