import { createPublicKey, createVerify } from 'node:crypto';
import { config } from './config.js';
import { log } from './log.js';

/**
 * Verifies the Usion access token a client mints with
 * `Usion.game._fetchDirectAccess()` before dialling this server, against the
 * platform's public JWKS. This is the only thing standing between "a player"
 * and "anyone with a WebSocket client and a room code", so `authRequired`
 * defaults ON in production.
 *
 * Zero-dependency by design: Node can build a public key straight from a JWK.
 */

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache = { keys: new Map(), fetchedAt: 0 };

const b64urlToBuffer = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const decodeJson = (s) => JSON.parse(b64urlToBuffer(s).toString('utf8'));

async function getKey(kid, { allowRefetch = true } = {}) {
  const fresh = Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid);

  if (!allowRefetch && fresh) return null;

  const res = await fetch(config.jwksUrl, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = await res.json();

  const keys = new Map();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA') continue;
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    } catch (err) {
      log.warn('jwks.bad_key', { kid: jwk.kid, err: String(err) });
    }
  }
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys.get(kid) ?? null;
}

/**
 * @returns {Promise<{userId: string, name?: string, raw: object}>}
 * @throws {Error} on any validation failure — callers must reject the socket
 */
export async function verifyUsionToken(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new Error('malformed token');
  }
  const [headerPart, payloadPart, signaturePart] = token.split('.');

  const header = decodeJson(headerPart);
  if (header.alg !== 'RS256') throw new Error(`unexpected alg: ${header.alg}`);
  if (!header.kid) throw new Error('missing kid');

  const key = await getKey(header.kid);
  if (!key) throw new Error(`unknown kid: ${header.kid}`);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerPart}.${payloadPart}`);
  verifier.end();
  if (!verifier.verify(key, b64urlToBuffer(signaturePart))) {
    throw new Error('bad signature');
  }

  const payload = decodeJson(payloadPart);
  const nowSec = Math.floor(Date.now() / 1000);
  const skew = 30;
  if (payload.exp != null && nowSec > payload.exp + skew) throw new Error('token expired');
  if (payload.nbf != null && nowSec + skew < payload.nbf) throw new Error('token not yet valid');
  if (config.tokenIssuer && payload.iss && payload.iss !== config.tokenIssuer) {
    throw new Error(`unexpected issuer: ${payload.iss}`);
  }
  if (config.tokenAudience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(config.tokenAudience)) throw new Error('audience mismatch');
  }
  if (!payload.sub) throw new Error('missing sub');

  return { userId: String(payload.sub), name: payload.name, raw: payload };
}

/**
 * socket.io middleware. With auth off (local dev only) it accepts a
 * self-declared identity — which is exactly why `authRequired` is derived from
 * NODE_ENV rather than left to a caller to remember.
 */
export function authMiddleware() {
  return async (socket, next) => {
    const { token, devUserId, devUserName } = socket.handshake.auth ?? {};

    if (!config.authRequired) {
      socket.data.userId = String(devUserId || `dev_${socket.id.slice(0, 8)}`);
      socket.data.userName = devUserName ? String(devUserName) : undefined;
      socket.data.authenticated = false;
      return next();
    }

    try {
      const claims = await verifyUsionToken(token);
      socket.data.userId = claims.userId;
      socket.data.userName = claims.name;
      socket.data.authenticated = true;
      return next();
    } catch (err) {
      log.warn('auth.rejected', { socketId: socket.id, err: String(err) });
      const failure = new Error('unauthenticated');
      failure.data = { code: 'UNAUTHENTICATED' };
      return next(failure);
    }
  };
}
