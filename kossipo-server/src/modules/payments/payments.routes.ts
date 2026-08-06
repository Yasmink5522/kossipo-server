import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { HttpError } from '../../utils/http-error';
import { logAction } from '../audit/audit.service';
import { emit } from '../../realtime/socket';
import { EVENTS, ROOMS } from '../../realtime/events';
import { ORDER_INCLUDE } from '../orders/orders.service';
import { buildTicket } from '../orders/tickets';

export const paymentsRouter = Router();

const paySchema = z.object({
  reglements: z
    .array(
      z.object({
        method: z.nativeEnum(PaymentMethod),
        amount: z.number().int().min(1, 'Montant invalide'),
        received: z.number().int().min(0).optional(),
        reference: z.string().max(60).optional(),
      }),
    )
    .min(1, 'Au moins un règlement est requis'),
});

/**
 * Encaisse une commande. Accepte un règlement unique ou un paiement mixte
 * (espèces + mobile money + carte). La monnaie n'est rendue que sur espèces.
 */
paymentsRouter.post(
  '/commande/:orderId',
  authenticate,
  requirePermission('payment:create'),
  validate(paySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof paySchema>;
    const userId = req.auth!.sub;

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: req.params.orderId },
        include: { payments: true },
      });
      if (order.status === 'ANNULEE') throw HttpError.badRequest('Commande annulée');
      if (order.status === 'PAYEE') throw HttpError.badRequest('Commande déjà réglée');

      const session = await tx.cashSession.findFirst({ where: { userId, status: 'OUVERTE' } });
      if (!session) throw HttpError.badRequest('Ouvrez votre caisse avant d\'encaisser');

      const dejaRegle = order.payments.reduce((s, p) => s + p.amount, 0);
      const reste = order.total - dejaRegle;
      const encaisse = body.reglements.reduce((s, r) => s + r.amount, 0);
      if (encaisse > reste) {
        throw HttpError.badRequest(
          `Montant trop élevé : il reste ${reste} FCFA à régler sur cette commande`,
        );
      }

      let monnaie = 0;
      for (const reglement of body.reglements) {
        const especes = reglement.method === 'ESPECES';
        const recu = especes ? (reglement.received ?? reglement.amount) : reglement.amount;
        if (especes && recu < reglement.amount) {
          throw HttpError.badRequest('Le montant reçu est inférieur au montant à régler');
        }
        const rendu = especes ? recu - reglement.amount : 0;
        monnaie += rendu;

        await tx.payment.create({
          data: {
            orderId: order.id,
            method: reglement.method,
            amount: reglement.amount,
            received: recu,
            change: rendu,
            reference: reglement.reference ?? null,
            userId,
            cashSessionId: session.id,
          },
        });
      }

      const paidTotal = dejaRegle + encaisse;
      const solde = paidTotal >= order.total;

      await tx.order.update({
        where: { id: order.id },
        data: {
          paidTotal,
          ...(solde ? { status: 'PAYEE', closedAt: new Date() } : {}),
          ...(order.cashSessionId ? {} : { cashSessionId: session.id }),
        },
      });

      if (solde && order.tableId) {
        await tx.restaurantTable.update({ where: { id: order.tableId }, data: { status: 'PAYEE' } });
      }

      const updated = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: ORDER_INCLUDE,
      });
      return { order: updated, monnaie, solde, reste: Math.max(0, order.total - paidTotal) };
    });

    const recu = body.reglements.reduce((s, r) => s + (r.received ?? r.amount), 0);
    const ticket = await buildTicket(result.order, 'RECU', { recu, monnaie: result.monnaie });

    await logAction(req, 'ENCAISSEMENT', 'Order', result.order.id, {
      montant: body.reglements.reduce((s, r) => s + r.amount, 0),
      moyens: body.reglements.map((r) => r.method),
    });
    emit(EVENTS.ORDER_PAID, result.order);
    emit(EVENTS.DASHBOARD_REFRESH, { at: new Date().toISOString() }, [ROOMS.ADMIN]);
    if (result.order.tableId) {
      emit(EVENTS.TABLE_UPDATED, { id: result.order.tableId, status: result.solde ? 'PAYEE' : 'SERVIE' });
    }

    res.json({
      commande: result.order,
      monnaie: result.monnaie,
      resteAPayer: result.reste,
      solde: result.solde,
      ticket,
    });
  }),
);

/** Libère la table après le départ des clients. */
paymentsRouter.post(
  '/commande/:orderId/liberer-table',
  authenticate,
  requirePermission('table:update'),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: req.params.orderId } });
    if (!order.tableId) return res.json({ message: 'Aucune table associée' });
    const table = await prisma.restaurantTable.update({
      where: { id: order.tableId },
      data: { status: 'LIBRE' },
    });
    await logAction(req, 'LIBERATION_TABLE', 'RestaurantTable', table.id);
    emit(EVENTS.TABLE_UPDATED, table);
    return res.json(table);
  }),
);

paymentsRouter.get(
  '/',
  authenticate,
  requirePermission('payment:read'),
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' ? new Date(`${req.query.to}T23:59:59.999`) : undefined;
    res.json(
      await prisma.payment.findMany({
        where: from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
        include: {
          order: { select: { number: true, zone: { select: { name: true } } } },
          user: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    );
  }),
);
