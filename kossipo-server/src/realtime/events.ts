/** Catalogue des évènements temps réel diffusés par le serveur. */
export const EVENTS = {
  TABLE_UPDATED: 'table:updated',
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  ORDER_SENT: 'order:sent',
  ORDER_PAID: 'order:paid',
  ORDER_CANCELLED: 'order:cancelled',
  ITEM_STATUS: 'item:status',
  STOCK_UPDATED: 'stock:updated',
  STOCK_ALERT: 'stock:alert',
  CASH_OPENED: 'cash:opened',
  CASH_CLOSED: 'cash:closed',
  DASHBOARD_REFRESH: 'dashboard:refresh',
  PRESENCE: 'presence:updated',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Salles de diffusion : chaque poste ne reçoit que ce qui le concerne. */
export const ROOMS = {
  ADMIN: 'room:admin',
  POS: 'room:pos',
  KITCHEN: 'room:kitchen',
  BAR: 'room:bar',
} as const;
