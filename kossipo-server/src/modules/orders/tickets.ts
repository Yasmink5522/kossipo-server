import { prisma } from '../../config/prisma';
import type { FullOrder } from './orders.service';

export type TicketKind = 'CUISINE' | 'BAR' | 'RECU' | 'FACTURE' | 'PRE_ADDITION';

export interface TicketLine {
  nom: string;
  quantite: number;
  prixUnitaire: number;
  total: number;
  note?: string | null;
}

export interface Ticket {
  type: TicketKind;
  largeur: 58 | 80;
  enteteLogo: boolean;
  restaurant: string;
  adresse?: string;
  telephone?: string;
  numeroTicket: string;
  date: string;
  heure: string;
  zone: string;
  table: string;
  caissier: string;
  couverts: number;
  lignes: TicketLine[];
  sousTotal: number;
  remise: number;
  total: number;
  reglements?: { moyen: string; montant: number }[];
  recu?: number;
  monnaie?: number;
  piedDePage: string;
}

async function settings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function frDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function frTime(d: Date) {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Construit la charge utile d'un ticket. Le rendu ESC/POS est fait côté
 * caisse (Electron) : le serveur reste indépendant du modèle d'imprimante.
 */
export async function buildTicket(
  order: FullOrder,
  type: TicketKind,
  options: { onlyItemIds?: string[]; recu?: number; monnaie?: number } = {},
): Promise<Ticket> {
  const config = await settings();
  const now = new Date();

  let lignes = order.items.filter((i) => i.status !== 'ANNULE');
  if (options.onlyItemIds) lignes = lignes.filter((i) => options.onlyItemIds!.includes(i.id));
  if (type === 'CUISINE') lignes = lignes.filter((i) => i.destination === 'KITCHEN');
  if (type === 'BAR') lignes = lignes.filter((i) => i.destination === 'BAR');

  const sousTotal = lignes.reduce((s, i) => s + i.total, 0);
  const production = type === 'CUISINE' || type === 'BAR';

  return {
    type,
    largeur: Number(config['imprimante.largeur'] ?? 80) === 58 ? 58 : 80,
    enteteLogo: !production && config['ticket.logo'] !== 'false',
    restaurant: config['restaurant.nom'] ?? 'KOSSIPO RESTAURANT',
    adresse: config['restaurant.adresse'] ?? 'San-Pédro, Côte d\'Ivoire',
    telephone: config['restaurant.telephone'] ?? '',
    numeroTicket: order.number,
    date: frDate(now),
    heure: frTime(now),
    zone: order.zone.name,
    table: order.table ? order.table.label : 'À emporter',
    caissier: order.user.fullName,
    couverts: order.guests,
    lignes: lignes.map((i) => ({
      nom: i.name,
      quantite: i.quantity,
      prixUnitaire: production ? 0 : i.unitPrice,
      total: production ? 0 : i.total,
      note: i.note,
    })),
    sousTotal: production ? 0 : sousTotal,
    remise: production ? 0 : order.discount,
    total: production ? 0 : Math.max(0, sousTotal - order.discount),
    reglements:
      production || order.payments.length === 0
        ? undefined
        : order.payments.map((p) => ({ moyen: p.method, montant: p.amount })),
    recu: options.recu,
    monnaie: options.monnaie,
    piedDePage: production
      ? `Commande ${order.number}`
      : (config['ticket.pied'] ?? 'Merci de votre visite'),
  };
}
