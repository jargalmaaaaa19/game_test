const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  port: int(process.env.PORT, 3200),

  // Origins allowed to open a socket. Entries may contain `*` in the hostname,
  // e.g. `https://*.vercel.app` — see isAllowedOrigin below.
  corsOrigins: list(process.env.CORS_ORIGINS).length
    ? list(process.env.CORS_ORIGINS)
    : ['http://localhost:5173', 'http://localhost:3000'],

  // Verify the Usion RS256 access token on connect. Leave ON in production —
  // without it anybody can open a socket and claim any player id.
  authRequired: bool(process.env.USION_AUTH_REQUIRED, process.env.NODE_ENV === 'production'),
  jwksUrl: process.env.USION_JWKS_URL || 'https://usions.com/.well-known/jwks.json',
  tokenIssuer: process.env.USION_TOKEN_ISSUER || 'https://usions.com',
  tokenAudience: process.env.USION_TOKEN_AUDIENCE || process.env.USION_SERVICE_ID || '',

  // Dev conveniences. These are checked at every call site, not just declared —
  // a bot-fill flag that existed but was never read once hijacked real rooms.
  devTools: bool(process.env.DEV_TOOLS, false),

  // Force the programme while building a sport, e.g. DEV_PROGRAMME=sprint_100m.
  // Only honoured when devTools is on, and the check happens at the call site
  // in phases.js — a flag that exists but is never read is how a bot-fill
  // helper once hijacked live rooms.
  devProgramme: list(process.env.DEV_PROGRAMME),

  // Two players may not compete under the same flag.
  uniqueFlags: bool(process.env.UNIQUE_FLAGS, true),

  logLevel: process.env.LOG_LEVEL || 'info',
};

/**
 * Is this browser origin allowed to open a socket?
 *
 * Two reasons this is a function rather than the bare list handed to socket.io:
 *
 * 1. Vercel gives EVERY preview deployment its own hostname, so an exact-match
 *    list breaks on the next push. `https://*.vercel.app` keeps previews
 *    working. `*` matches one label only, so it cannot be widened accidentally
 *    into someone else's subdomain.
 * 2. A literal `*` origin is illegal once `credentials: true` is set — browsers
 *    reject it. Echoing back the specific origin, which a matcher lets us do,
 *    is legal and just as tight.
 */
/**
 * Does `origin` match one allow-list `pattern`?
 *
 * Deliberately NOT a regex. Building one means escaping the pattern, and an
 * escaping bug in a security check fails open — it is the kind of code that
 * looks right and silently allows everything. String surgery has no escaping
 * to get wrong.
 *
 * A `*` matches exactly one hostname label: it may not swallow a dot, so
 * `https://*.vercel.app` never matches `https://anything.evil.com`, nor
 * `https://a.b.vercel.app`.
 */
function originMatches(pattern, origin) {
  const want = pattern.trim().toLowerCase();
  const got = origin.toLowerCase();
  const star = want.indexOf('*');

  if (star === -1) return got === want;
  if (want.indexOf('*', star + 1) !== -1) return false; // one wildcard only

  const head = want.slice(0, star);
  const tail = want.slice(star + 1);
  if (got.length < head.length + tail.length) return false;
  if (!got.startsWith(head) || !got.endsWith(tail)) return false;

  const filled = got.slice(head.length, got.length - tail.length);
  return filled.length > 0 && !filled.includes('.');
}

/**
 * Is this browser origin allowed to open a socket?
 *
 * A matcher rather than the bare list, for two reasons:
 *
 * 1. Vercel gives EVERY preview deployment its own hostname, so an exact-match
 *    list breaks on the next push. `https://*.vercel.app` keeps previews alive.
 * 2. A literal `*` origin is illegal once `credentials: true` is set — browsers
 *    reject it. Echoing back the specific origin, which a matcher lets us do,
 *    is legal and just as tight.
 */
export function isAllowedOrigin(origin) {
  // No Origin header at all: health checks, curl, native app WebViews.
  if (!origin) return true;
  return config.corsOrigins.some((pattern) => originMatches(pattern, origin));
}
