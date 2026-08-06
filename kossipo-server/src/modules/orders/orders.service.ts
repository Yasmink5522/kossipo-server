import type { Destination, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/http-error';
import { nextOrderNumber } from '../../utils/order-number';
import { consumeForItems } from '../stock/stock.service';

export const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' } },
  table: { select: { id: true, number: true, label: true, zoneId: true } },
  zone: { select: { id: true, code: true, name: true, freeDrinkPrice: true } },
  user: { select: { id: true, fullName: true } },
  payments: true,
} satisfies Prisma.OrderInclude;

export type FullOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const OPEN_STATUSES = ['OUVERTE', 'ENVOYEE', 'EN_PREPARATION', 'SERVIE'] as const;

export async function getOrder(id: string): Promise<FullOrder> {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) throw HttpError.notFound('Commande introuvable');
  return order;
}

/** Recalcule le total à partir des lignes non annulées, remise déduite. */
export async function recomputeTotal(tx: Prisma.TransactionClient, orderId: string): Promise<number> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  const subtotal = order.items
    .filter((i) => i.status !== 'ANNULE')
    .reduce((sum, i) => sum + i.total, 0);
  const total = Math.max(0, subtotal - order.discount);
  await tx.order.update({ where: { id: orderId }, data: { total } });
  return total;
}

/** Prix applicable à un produit dans une zone donnée. */
async function resolvePrice(
  tx: Prisma.TransactionClient,
  productId: string,
  zoneId: string,
  overridePrice?: number,
) {
  const price = await tx.productPrice.findUnique({
    where: { productId_zoneId: { productId, zoneId } },
    include: { product: { include: { category: true } } },
  });
  if (!price) throw HttpError.badRequest('Ce produit n\'est pas disponible dans cette zone');
  if (!price.available) throw HttpError.badRequest(`${price.product.name} est indisponible`);

  if (price.freePrice) {
    if (overridePrice === undefined || overridePrice < 0) {
      throw HttpError.badRequest(`Saisissez le prix de « ${price.product.name} »`);
    }
    return { unitPrice: overridePrice, product: price.product };
  }
  // Un prix libre n'est accepté que si la fiche l'autorise : sinon le tarif fait foi.
  return { unitPrice: price.price, product: price.product };
}

export async function createOrder(params: {
  tableId: string;
  userId: string;
  guests: number;
  note?: string;
}): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findUnique({ where: { id: params.tableId } });
    if (!table) throw HttpError.notFound('Table introuvable');

    const existing = await tx.order.findFirst({
      where: { tableId: table.id, status: { in: [...OPEN_STATUSES] } },
    });
    if (existing) throw HttpError.conflict('Cette table a déjà une commande en cours');

    const session = await tx.cashSession.findFirst({
      where: { userId: params.userId, status: 'OUVERTE' },
    });

    const order = await tx.order.create({
      data: {
        number: await nextOrderNumber(),
        tableId: table.id,
        zoneId: table.zoneId,
        userId: params.userId,
        guests: params.guests,
        note: params.note ?? null,
        cashSessionId: session?.id ?? null,
      },
      include: ORDER_INCLUDE,
    });

    await tx.restaurantTable.update({ where: { id: table.id }, data: { status: 'OCCUPEE' } });
    return order;
  });
}

export async function addItems(
  orderId: string,
  lines: { productId: string; quantity: number; unitPrice?: number; note?: string }[],
): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (['PAYEE', 'ANNULEE'].includes(order.status)) {
      throw HttpError.badRequest('Cette commande est clôturée');
    }

    for (const line of lines) {
      if (line.quantity <= 0) throw HttpError.badRequest('Quantité invalide');
      const { unitPrice, product } = await resolvePrice(tx, line.productId, order.zoneId, line.unitPrice);

      // Fusionne avec une ligne identique encore non envoyée.
      const mergeable = await tx.orderItem.findFirst({
        where: {
          orderId,
          productId: line.productId,
          status: 'NOUVEAU',
          unitPrice,
          note: line.note ?? null,
        },
      });

      if (mergeable) {
        const quantity = mergeable.quantity + line.quantity;
        await tx.orderItem.update({
          where: { id: mergeable.id },
          data: { quantity, total: quantity * unitPrice },
        });
      } else {
        await tx.orderItem.create({
          data: {
            orderId,
            productId: line.productId,
            name: product.name,
            quantity: line.quantity,
            unitPrice,
            total: line.quantity * unitPrice,
            destination: product.category.destination as Destination,
            note: line.note ?? null,
          },
        });
      }
    }

    await recomputeTotal(tx, orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  });
}

export async function updateItem(
  orderId: string,
  itemId: string,
  data: { quantity?: number; note?: string; unitPrice?: number },
): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.orderId !== orderId) throw HttpError.badRequest('Cette ligne appartient à une autre commande');
    if (item.status === 'ANNULE') throw HttpError.badRequest('Ligne déjà annulée');

    const quantity = data.quantity ?? item.quantity;
    if (quantity <= 0) throw HttpError.badRequest('Quantité invalide');
    const unitPrice = data.unitPrice ?? item.unitPrice;

    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        quantity,
        unitPrice,
        total: quantity * unitPrice,
        ...(data.note !== undefined ? { note: data.note } : {}),
      },
    });

    await recomputeTotal(tx, orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  });
}

/**
 * Retire une ligne. Si elle a déjà été envoyée en cuisine, elle est marquée
 * ANNULE (traçabilité) au lieu d'être supprimée, et le motif est obligatoire.
 */
export async function removeItem(orderId: string, itemId: string, reason?: string): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.orderId !== orderId) throw HttpError.badRequest('Cette ligne appartient à une autre commande');

    if (item.status === 'NOUVEAU') {
      await tx.orderItem.delete({ where: { id: itemId } });
    } else {
      if (!reason) throw HttpError.badRequest('Un motif est requis pour annuler une ligne déjà envoyée');
      await tx.orderItem.update({
        where: { id: itemId },
        data: { status: 'ANNULE', note: reason },
      });
    }

    await recomputeTotal(tx, orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  });
}

/**
 * Envoie les nouvelles lignes en production, déclenche la consommation de stock
 * et renvoie les tickets à imprimer (cuisine / bar).
 */
export async function sendOrder(orderId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, table: true, zone: true, user: true },
    });
    if (['PAYEE', 'ANNULEE'].includes(order.status)) {
      throw HttpError.badRequest('Cette commande est clôturée');
    }

    const fresh = order.items.filter((i) => i.status === 'NOUVEAU');
    if (fresh.length === 0) throw HttpError.badRequest('Aucune nouvelle ligne à envoyer');

    const now = new Date();
    await tx.orderItem.updateMany({
      where: { orderId, status: 'NOUVEAU' },
      data: { status: 'ENVOYE', sentAt: now },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'ENVOYEE', sentAt: order.sentAt ?? now },
    });
    if (order.tableId) {
      await tx.restaurantTable.update({
        where: { id: order.tableId },
        data: { status: 'COMMANDE_ENVOYEE' },
      });
    }

    const alerts = await consumeForItems(
      tx,
      fresh.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      { userId, orderId },
    );

    const updated = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
    return { order: updated, sentItems: fresh, alerts };
  });
}

/** Fait avancer l'état des lignes (cuisine / bar). */
export async function markItemsStatus(
  orderId: string,
  itemIds: string[],
  status: 'EN_PREPARATION' | 'PRET' | 'SERVI',
): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    await tx.orderItem.updateMany({ where: { id: { in: itemIds }, orderId }, data: { status } });

    const items = await tx.orderItem.findMany({ where: { orderId, status: { not: 'ANNULE' } } });
    const allServed = items.length > 0 && items.every((i) => i.status === 'SERVI');
    const anyPreparing = items.some((i) => i.status === 'EN_PREPARATION');

    const orderStatus = allServed ? 'SERVIE' : anyPreparing ? 'EN_PREPARATION' : undefined;
    if (orderStatus) {
      const order = await tx.order.update({ where: { id: orderId }, data: { status: orderStatus } });
      if (order.tableId) {
        await tx.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: allServed ? 'SERVIE' : 'EN_PREPARATION' },
        });
      }
    }

    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  });
}

export async function cancelOrder(orderId: string, reason: string): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
    if (order.status === 'PAYEE') throw HttpError.badRequest('Une commande payée ne peut pas être annulée');
    if (order.payments.length > 0) throw HttpError.badRequest('Des règlements existent déjà sur cette commande');

    await tx.orderItem.updateMany({ where: { orderId }, data: { status: 'ANNULE' } });
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'ANNULEE', cancelReason: reason, closedAt: new Date(), total: 0 },
    });
    if (order.tableId) {
      await tx.restaurantTable.update({ where: { id: order.tableId }, data: { status: 'LIBRE' } });
    }
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  });
}

/** Déplace une commande vers une autre table libre. */
export async function moveOrder(orderId: string, targetTableId: string): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (['PAYEE', 'ANNULEE'].includes(order.status)) throw HttpError.badRequest('Commande clôturée');

    const target = await tx.restaurantTable.findUniqueOrThrow({ where: { id: targetTableId } });
    const occupied = await tx.order.findFirst({
      where: { tableId: target.id, status: { in: [...OPEN_STATUSES] } },
    });
    if (occupied) throw HttpError.conflict('La table de destination est déjà occupée');

    if (order.tableId) {
      await tx.restaurantTable.update({ where: { id: order.tableId }, data: { status: 'LIBRE' } });
    }
    await tx.restaurantTable.update({ where: { id: target.id }, data: { status: 'OCCUPEE' } });

    // Le changement de zone modifie la grille tarifaire : les lignes déjà
    // saisies sont réévaluées au tarif de la nouvelle zone.
    if (target.zoneId !== order.zoneId) {
      const items = await tx.orderItem.findMany({ where: { orderId, status: { not: 'ANNULE' } } });
      for (const item of items) {
        const price = await tx.productPrice.findUnique({
          where: { productId_zoneId: { productId: item.productId, zoneId: target.zoneId } },
        });
        if (price && !price.freePrice) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { unitPrice: price.price, total: price.price * item.quantity },
          });
        }
      }
    }

    await tx.order.update({ where: { id: orderId }, data: { tableId: target.id, zoneId: target.zoneId } });
    await recomputeTotal(tx, orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  });
}

/** Fusionne la commande source dans la commande cible et libère la table source. */
export async function mergeOrders(sourceId: string, targetId: string): Promise<FullOrder> {
  if (sourceId === targetId) throw HttpError.badRequest('Sélectionnez deux commandes différentes');
  return prisma.$transaction(async (tx) => {
    const source = await tx.order.findUniqueOrThrow({ where: { id: sourceId }, include: { items: true } });
    const target = await tx.order.findUniqueOrThrow({ where: { id: targetId } });

    if (['PAYEE', 'ANNULEE'].includes(source.status) || ['PAYEE', 'ANNULEE'].includes(target.status)) {
      throw HttpError.badRequest('Une des commandes est clôturée');
    }

    for (const item of source.items.filter((i) => i.status !== 'ANNULE')) {
      let unitPrice = item.unitPrice;
      if (source.zoneId !== target.zoneId) {
        const price = await tx.productPrice.findUnique({
          where: { productId_zoneId: { productId: item.productId, zoneId: target.zoneId } },
        });
        if (price && !price.freePrice) unitPrice = price.price;
      }
      await tx.orderItem.create({
        data: {
          orderId: target.id,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice,
          total: unitPrice * item.quantity,
          status: item.status,
          destination: item.destination,
          note: item.note,
          sentAt: item.sentAt,
        },
      });
    }

    await tx.order.update({
      where: { id: source.id },
      data: {
        status: 'ANNULEE',
        cancelReason: `Fusionnée dans ${target.number}`,
        mergedIntoId: target.id,
        closedAt: new Date(),
        total: 0,
      },
    });
    await tx.orderItem.updateMany({ where: { orderId: source.id }, data: { status: 'ANNULE' } });
    if (source.tableId) {
      await tx.restaurantTable.update({ where: { id: source.tableId }, data: { status: 'LIBRE' } });
    }
    await tx.order.update({
      where: { id: target.id },
      data: { guests: target.guests + source.guests },
    });

    await recomputeTotal(tx, target.id);
    return tx.order.findUniqueOrThrow({ where: { id: target.id }, include: ORDER_INCLUDE });
  });
}

/**
 * Sépare une addition : les lignes désignées partent dans une nouvelle
 * commande rattachée à la même table (addition séparée).
 */
export async function splitOrder(
  orderId: string,
  parts: { itemId: string; quantity: number }[],
  userId: string,
): Promise<{ source: FullOrder; nouvelle: FullOrder }> {
  if (parts.length === 0) throw HttpError.badRequest('Sélectionnez au moins une ligne à séparer');

  return prisma.$transaction(async (tx) => {
    const source = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (['PAYEE', 'ANNULEE'].includes(source.status)) throw HttpError.badRequest('Commande clôturée');

    const created = await tx.order.create({
      data: {
        number: await nextOrderNumber(),
        tableId: source.tableId,
        zoneId: source.zoneId,
        userId,
        guests: 1,
        note: `Addition séparée de ${source.number}`,
        status: source.status,
        cashSessionId: source.cashSessionId,
      },
    });

    for (const part of parts) {
      const item = source.items.find((i) => i.id === part.itemId);
      if (!item) throw HttpError.badRequest('Ligne introuvable dans cette commande');
      if (part.quantity <= 0 || part.quantity > item.quantity) {
        throw HttpError.badRequest(`Quantité à séparer invalide pour ${item.name}`);
      }

      await tx.orderItem.create({
        data: {
          orderId: created.id,
          productId: item.productId,
          name: item.name,
          quantity: part.quantity,
          unitPrice: item.unitPrice,
          total: item.unitPrice * part.quantity,
          status: item.status,
          destination: item.destination,
          note: item.note,
          sentAt: item.sentAt,
        },
      });

      const remaining = item.quantity - part.quantity;
      if (remaining === 0) {
        await tx.orderItem.delete({ where: { id: item.id } });
      } else {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { quantity: remaining, total: remaining * item.unitPrice },
        });
      }
    }

    await recomputeTotal(tx, source.id);
    await recomputeTotal(tx, created.id);

    return {
      source: await tx.order.findUniqueOrThrow({ where: { id: source.id }, include: ORDER_INCLUDE }),
      nouvelle: await tx.order.findUniqueOrThrow({ where: { id: created.id }, include: ORDER_INCLUDE }),
    };
  });
}

export async function applyDiscount(orderId: string, discount: number): Promise<FullOrder> {
  return prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { discount } });
    await recomputeTotal(tx, orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
  });
}

export async function openOrders() {
  return prisma.order.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    include: ORDER_INCLUDE,
    orderBy: { openedAt: 'asc' },
  });
}

/** File de production filtrée par destination (écran cuisine ou bar). */
export async function productionQueue(destination: 'KITCHEN' | 'BAR') {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['ENVOYEE', 'EN_PREPARATION'] },
      items: { some: { destination, status: { in: ['ENVOYE', 'EN_PREPARATION'] } } },
    },
    include: {
      items: { where: { destination, status: { in: ['ENVOYE', 'EN_PREPARATION'] } } },
      table: { select: { number: true, label: true } },
      zone: { select: { name: true, code: true } },
    },
    orderBy: { sentAt: 'asc' },
  });
  return orders;
}
