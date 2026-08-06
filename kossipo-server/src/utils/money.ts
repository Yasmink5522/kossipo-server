/** Le FCFA n'a pas de subdivision : tous les montants sont des entiers. */
export function toFcfa(value: number): number {
  return Math.round(value);
}

export function formatFcfa(value: number): string {
  return `${toFcfa(value).toLocaleString('fr-FR').replace(/\u202f/g, ' ')} FCFA`;
}

/** Arrondi au multiple de 5 FCFA le plus proche (pièces en circulation). */
export function roundToCoin(value: number): number {
  return Math.round(value / 5) * 5;
}
