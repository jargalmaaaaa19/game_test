import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { SWEEP_INTERVAL_MS } from '../../shared/constants.js';
import { config } from './config.js';
import { log } from './log.js';
import { RoomStore } from './store.js';
import { authMiddleware } from './auth.js';
import { expirePlayer, registerHandlers } from './handlers.js';

const store = new RoomStore();

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), ...store.stats() }));
    return;
  }
  res.writeHead(404).end();
});

const io = new Server(http, {
  cors: { origin: config.corsOrigins, credentials: true },
  // Mobile WebViews background aggressively; a short ping timeout turns an app
  // switch into a disconnect. The room's own grace window is the real backstop.
  pingInterval: 20_000,
  pingTimeout: 25_000,
  maxHttpBufferSize: 8 * 1024,
});

io.use(authMiddleware());
registerHandlers(io, store);

const sweeper = setInterval(() => {
  store.sweep(Date.now(), (room, playerId) => expirePlayer(io, room, playerId));
}, SWEEP_INTERVAL_MS);
sweeper.unref();

http.listen(config.port, () => {
  log.info('server.listening', {
    port: config.port,
    authRequired: config.authRequired,
    devTools: config.devTools,
    uniqueFlags: config.uniqueFlags,
  });
  if (!config.authRequired) {
    log.warn('server.auth_disabled', { hint: 'set USION_AUTH_REQUIRED=true before deploying' });
  }
});

const shutdown = (signal) => {
  log.info('server.shutdown', { signal, ...store.stats() });
  clearInterval(sweeper);
  io.close(() => http.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
