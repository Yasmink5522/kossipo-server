import { prisma } from '../config/prisma';

/**
 * Numéro de commande lisible : KP-AAMMJJ-0001, remis à zéro chaque jour.
 */
export async function nextOrderNumber(): Promise<string> {
  const now = new Date();
  const day = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const prefix = `KP-${day}-`;

  const last = await prisma.order.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  const sequence = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}
