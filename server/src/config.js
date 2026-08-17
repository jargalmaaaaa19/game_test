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

  // CORS origins allowed to open a socket. '*' only when explicitly asked for.
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
