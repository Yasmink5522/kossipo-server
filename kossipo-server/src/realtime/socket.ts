import type { Server as HttpServer } from 'http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { env } from '../config/env';
import { verifyToken, type AuthPayload } from '../middleware/auth';
import { EVENTS, ROOMS, type EventName } from './events';

let io: SocketServer | null = null;

interface Presence {
  userId: string;
  fullName: string;
  role: string;
  since: string;
}

const online = new Map<string, Presence>();

/** Salles auxquelles un rôle est abonné d'office. */
function roomsForRole(role: string): string[] {
  switch (role) {
    case 'ADMIN':
    case 'MANAGER':
      return [ROOMS.ADMIN, ROOMS.POS, ROOMS.KITCHEN, ROOMS.BAR];
    case 'CASHIER':
      return [ROOMS.POS];
    case 'KITCHEN':
      return [ROOMS.KITCHEN];
    case 'BAR':
      return [ROOMS.BAR];
    default:
      return [];
  }
}

export function initSocket(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    cors: { origin: env.corsOrigins, credentials: true },
    pingInterval: 20000,
    pingTimeout: 25000,
  });

  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? '';
    if (!token) return next(new Error('Jeton manquant'));
    try {
      const payload = verifyToken(token);
      (socket.data as { auth: AuthPayload }).auth = payload;
      next();
    } catch {
      next(new Error('Jeton invalide'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const auth = (socket.data as { auth: AuthPayload }).auth;
    roomsForRole(auth.role).forEach((room) => socket.join(room));
    socket.join(`user:${auth.sub}`);

    online.set(socket.id, {
      userId: auth.sub,
      fullName: auth.fullName,
      role: auth.role,
      since: new Date().toISOString(),
    });
    broadcastPresence();

    socket.on('disconnect', () => {
      online.delete(socket.id);
      broadcastPresence();
    });
  });

  console.log('[ws] WebSocket prêt');
  return io;
}

function broadcastPresence(): void {
  const unique = new Map<string, Presence>();
  online.forEach((p) => unique.set(p.userId, p));
  io?.to(ROOMS.ADMIN).emit(EVENTS.PRESENCE, Array.from(unique.values()));
}

/** Diffuse un évènement à une ou plusieurs salles (toutes par défaut). */
export function emit(event: EventName, payload: unknown, rooms?: string[]): void {
  if (!io) return;
  if (!rooms || rooms.length === 0) {
    io.emit(event, payload);
    return;
  }
  rooms.forEach((room) => io?.to(room).emit(event, payload));
}

export function connectedUsers(): Presence[] {
  const unique = new Map<string, Presence>();
  online.forEach((p) => unique.set(p.userId, p));
  return Array.from(unique.values());
}
