import { useState } from 'react';
import { getCountry } from '@shared/countries.js';
import { t } from '../i18n.js';
import { buildShareText, eventName } from '../share.js';
import { shareVictory } from '../net/usion.js';
import Avatar3D from './Avatar3D.jsx';
import Flag from './Flag.jsx';
import Medal, { MedalTally } from './Medal.jsx';

/**
 * The Victory Share Card — the screenshot-shaped thing a player wants to send
 * to the group chat that started the game.
 */
export default function VictoryShareCard({ champion, standings, programme, players }) {
  const [state, setState] = useState('idle'); // idle | shared | copied | unavailable
  const byId = new Map(players.map((p) => [p.id, p]));
  const country = getCountry(champion.player.country);

  const onShare = async () => {
    const result = await shareVictory(
      buildShareText({ champion, standings: withNames(standings, byId), programme }),
    );
    setState(result);
    if (result !== 'unavailable') setTimeout(() => setState('idle'), 2200);
  };

  return (
    <section className="animate-rise">
      <div
        className="relative overflow-hidden rounded-3xl border border-amber-300/30
                   bg-gradient-to-b from-amber-300/10 via-neutral-900 to-neutral-950 p-5"
      >
        {/* A single soft glow behind the champion — drawn, not an image asset. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2
                     rounded-full bg-amber-300/20 blur-3xl"
        />

        <header className="relative flex items-center justify-between text-[10px] uppercase tracking-widest text-amber-200/70">
          <span>{t.appName}</span>
          <span>{t.finalStandings}</span>
        </header>

        <div className="relative mt-4 flex flex-col items-center">
          <Medal rank={1} className="h-12 w-12" title={t.champion} />
          {/* The hero moment of the whole match — worth a live, turning model. */}
          <Avatar3D
            skin={champion.player.skin} build={champion.player.build}
            outfit={champion.player.outfit}
            hair={champion.player.hair}
            className="mt-1 h-36 w-36"
            title={champion.player.name}
          />
          <p className="mt-2 flex items-center gap-2 text-xl font-bold">
            <Flag code={champion.player.country} className="h-4 w-6" />
            {champion.player.name}
          </p>
          <p className="text-xs uppercase tracking-widest text-amber-200/80">{t.champion}</p>

          <div className="mt-4 flex items-center gap-4">
            <span className="font-mono text-3xl font-bold">{champion.row.points}</span>
            <span className="text-xs text-neutral-500">{t.points}</span>
            <MedalTally
              gold={champion.row.gold}
              silver={champion.row.silver}
              bronze={champion.row.bronze}
            />
          </div>
        </div>

        {programme?.length > 0 && (
          <p className="relative mt-5 border-t border-white/5 pt-3 text-center text-[11px] leading-relaxed text-neutral-500">
            {programme.map(eventName).join(' · ')}
          </p>
        )}
      </div>

      <button type="button" className="btn-secondary mt-3" onClick={onShare}>
        {state === 'shared' ? t.shared : state === 'copied' ? t.copied : state === 'unavailable' ? t.shareUnavailable : t.shareVictory}
      </button>
    </section>
  );
}

/** The share text needs names; the standings rows only carry ids. */
function withNames(standings, byId) {
  return standings.map((row) => ({ ...row, name: byId.get(row.playerId)?.name ?? '' }));
}
