// Snapshot interpolation.
//
// The server ticks at 20 Hz; phones render at 60. Drawing whatever packet
// arrived last makes remote runners teleport — that is exactly what players
// read as "lag". Instead every client renders the world a fixed BUFFER_MS in
// the past and blends between the two snapshots that straddle that moment, so
// remote athletes glide even when a packet is late or lost.
//
// Embedded in the Usion host, `Usion.game.createInterpolation({serverFps: 20})`
// does this same job; this is the standalone equivalent, so the lobby works in
// a plain browser tab too.

export const BUFFER_MS = 100; // ~2 server ticks of slack

/** Keep a little over a second of history — enough to ride out a gap. */
const MAX_HISTORY_MS = 1_500;

export function pushSnapshot(net, serverTime, payload) {
  net.buffer.push({ t: serverTime, s: payload });
  const cutoff = serverTime - MAX_HISTORY_MS;
  while (net.buffer.length > 2 && net.buffer[0].t < cutoff) net.buffer.shift();
  net.lastServerT = serverTime;
}

/**
 * Estimate `serverNow - clientNow`.
 *
 * Each sample under-reads by one-way latency, so the running maximum is the
 * better estimate; it decays slowly so a genuine clock adjustment is still
 * followed. Never compare two devices' wall clocks directly — phones skew by
 * seconds.
 */
export function updateClock(net, serverTime, clientNow) {
  const sample = serverTime - clientNow;
  net.offset = net.offset === null ? sample : Math.max(sample, net.offset - 0.5);
}

export const serverNow = (net) => Date.now() + (net.offset ?? 0);

/**
 * Athlete states at `renderTime` (server clock), with `keys` linearly blended.
 * Returns the newest frame's values for everything else — flags like "finished"
 * must not be averaged into existence.
 */
export function sampleAt(net, renderTime, keys = ['x']) {
  const buf = net.buffer;
  if (buf.length === 0) return null;
  if (buf.length === 1 || renderTime <= buf[0].t) return buf[0].s;

  const last = buf[buf.length - 1];
  // Ran past the newest frame (packet late): hold, never extrapolate. Guessing
  // forward and then correcting back is a visible stutter.
  if (renderTime >= last.t) return last.s;

  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].t > renderTime) i -= 1;
  const from = buf[i - 1];
  const to = buf[i];
  const span = to.t - from.t;
  const alpha = span > 0 ? (renderTime - from.t) / span : 1;

  const out = { ...to.s, a: {} };
  for (const [id, next] of Object.entries(to.s.a)) {
    const prev = from.s.a[id];
    if (!prev) {
      out.a[id] = next;
      continue;
    }
    const blended = { ...next };
    for (const key of keys) {
      if (typeof prev[key] === 'number' && typeof next[key] === 'number') {
        blended[key] = prev[key] + (next[key] - prev[key]) * alpha;
      }
    }
    out.a[id] = blended;
  }
  return out;
}
