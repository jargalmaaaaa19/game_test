import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { SWEEP_INTERVAL_MS } from '../../shared/constants.js';
import { config, isAllowedOrigin } from './config.js';
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
  cors: { origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true },
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
    // WHETHER it is set, never what it is.
    serviceKey: config.serviceKey ? 'set' : 'unset',
  });
  // Say the posture out loud, with the reason. The failure this replaces was
  // invisible from the logs: the box looked healthy and refused every player.
  if (!config.authRequired) {
    log.warn('server.auth_disabled', {
      why: 'no USION_SERVICE_ID configured, so no platform token could ever validate',
      effect: 'anyone with the URL can open a room',
      fix: 'set USION_SERVICE_ID (or USION_AUTH_REQUIRED=true) for anything real',
    });
  }
  if (config.corsOrigins.length === 0) {
    log.warn('server.cors_open', {
      why: 'CORS_ORIGINS is unset',
      effect: 'any browser origin may connect',
      fix: 'set CORS_ORIGINS to your domains, e.g. https://your-app.vercel.app',
    });
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
