// Relative imports, not the `@shared` alias the components use: this module is
// also loaded by `tools/share.test.mjs` under plain Node, which knows nothing
// about Vite's resolver.
import { getEvent } from '../../shared/events/index.js';
import { getCountry } from '../../shared/countries.js';
import { t, lang } from './i18n.js';

export const eventName = (id) => getEvent(id)?.name?.[lang] ?? getEvent(id)?.name?.en ?? id;

/**
 * The line that actually leaves the app.
 *
 * Kept as text rather than a rendered image on purpose: `Usion.share` takes a
 * content type, and text pastes into any chat, survives every client, and needs
 * no canvas export. The card on screen is the trophy; this is the postcard.
 *
 * Plain JS, apart from the React tree, so it can be asserted in a test — a
 * share string is the one piece of this screen that leaves the device, and
 * "it looked right when I clicked it" is not a check.
 */
export function buildShareText({ champion, standings = [], programme = [] }) {
  const country = getCountry(champion.player.country);
  const medals = `${champion.row.gold}-${champion.row.silver}-${champion.row.bronze}`;
  const runnerUp = standings[1];

  return [
    `🏆 ${t.appName}`,
    `${country?.flag ?? ''} ${champion.player.name} — ${t.champion}`.trim(),
    `${champion.row.points} ${t.points} · 🥇🥈🥉 ${medals}`,
    runnerUp?.name ? `${t.place(2)}: ${runnerUp.name} (${runnerUp.points})` : null,
    programme.map(eventName).join(' · ') || null,
  ]
    .filter(Boolean)
    .join('\n');
}
