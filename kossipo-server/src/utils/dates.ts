/** Bornes de la journée d'exploitation (00:00 → 23:59:59.999) en heure locale du serveur. */
export function dayRange(date = new Date()): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { start, end };
}

export function rangeFromQuery(from?: string, to?: string): { start: Date; end: Date } {
  if (!from && !to) return dayRange();
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to) : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
