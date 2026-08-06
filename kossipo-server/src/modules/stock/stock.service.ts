import type { Prisma, PrismaClient, StockMovementType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { emit } from '../../realtime/socket';
import { EVENTS, ROOMS } from '../../realtime/events';

type Tx = Prisma.TransactionClient | PrismaClient;

/** Applique un mouvement et met à jour la quantité de l'article de façon atomique. */
export async function applyMovement(
  tx: Tx,
  params: {
    itemId: string;
    type: StockMovementType;
    quantity: number; // valeur absolue
    unitCost?: number;
    reason?: string;
    userId?: string | null;
    orderId?: string | null;
  },
) {
  const item = await tx.stockItem.findUnique({ where: { id: params.itemId } });
  if (!item) throw new Error(`Article de stock introuvable : ${params.itemId}`);

  const signed =
    params.type === 'ENTREE'
      ? params.quantity
      : params.type === 'INVENTAIRE'
        ? params.quantity - item.quantity // la quantité passée est le comptage réel
        : -params.quantity;

  const after = Number((item.quantity + signed).toFixed(3));

  await tx.stockItem.update({
    where: { id: item.id },
    data: {
      quantity: after,
      ...(params.type === 'ENTREE' && params.unitCost ? { unitCost: params.unitCost } : {}),
    },
  });

  const movement = await tx.stockMovement.create({
    data: {
      itemId: item.id,
      type: params.type,
      quantity: Math.abs(signed),
      before: item.quantity,
      after,
      unitCost: params.unitCost ?? item.unitCost,
      reason: params.reason ?? null,
      userId: params.userId ?? null,
      orderId: params.orderId ?? null,
    },
  });

  return { movement, item: { ...item, quantity: after }, alert: after <= item.minQuantity };
}

/**
 * Décrémente le stock à partir des fiches techniques des produits vendus.
 * Appelé lors de l'envoi de la commande en cuisine / au bar.
 */
export async function consumeForItems(
  tx: Tx,
  items: { productId: string; quantity: number }[],
  context: { userId: string; orderId: string },
) {
  const productIds = Array.from(new Set(items.map((i) => i.productId)));
  const recipes = await tx.recipeLine.findMany({ where: { productId: { in: productIds } } });
  if (recipes.length === 0) return [];

  // Regroupe la consommation par article de stock.
  const needed = new Map<string, number>();
  for (const item of items) {
    for (const line of recipes.filter((r) => r.productId === item.productId)) {
      needed.set(line.stockItemId, (needed.get(line.stockItemId) ?? 0) + line.quantity * item.quantity);
    }
  }

  const alerts: { nom: string; quantite: number; seuil: number }[] = [];
  for (const [stockItemId, quantity] of needed) {
    const result = await applyMovement(tx, {
      itemId: stockItemId,
      type: 'VENTE',
      quantity,
      reason: 'Consommation automatique (vente)',
      userId: context.userId,
      orderId: context.orderId,
    });
    if (result.alert) {
      alerts.push({
        nom: result.item.name,
        quantite: result.item.quantity,
        seuil: result.item.minQuantity,
      });
    }
  }
  return alerts;
}

/** Articles sous le seuil d'alerte. */
export async function lowStockItems() {
  const items = await prisma.stockItem.findMany({
    where: { active: true },
    include: { category: true },
    orderBy: { name: 'asc' },
  });
  return items.filter((i) => i.quantity <= i.minQuantity);
}

/** Valorisation totale du stock (quantité × coût unitaire). */
export async function stockValuation() {
  const items = await prisma.stockItem.findMany({ where: { active: true }, include: { category: true } });
  const parCategorie = new Map<string, number>();
  let total = 0;
  for (const item of items) {
    const value = Math.round(item.quantity * item.unitCost);
    total += value;
    parCategorie.set(item.category.name, (parCategorie.get(item.category.name) ?? 0) + value);
  }
  return {
    total,
    parCategorie: Array.from(parCategorie, ([categorie, valeur]) => ({ categorie, valeur })),
    nombreArticles: items.length,
  };
}

export function broadcastStockAlerts(alerts: { nom: string; quantite: number; seuil: number }[]) {
  if (alerts.length === 0) return;
  emit(EVENTS.STOCK_ALERT, alerts, [ROOMS.ADMIN, ROOMS.POS]);
}
