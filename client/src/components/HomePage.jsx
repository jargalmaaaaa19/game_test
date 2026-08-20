import { t, errorText } from '../i18n.js';
import AvatarStudio from './AvatarStudio.jsx';

export default function HomePage({ look, onLookChange, onCreate, onSolo, error, busy }) {

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-8 px-5 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">{t.appName}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t.tagline}</p>
      </header>

      <section className="card animate-rise">
        <h2 className="label">{t.myAthlete}</h2>
        <AvatarStudio value={look} onChange={onLookChange} />
      </section>

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errorText(error)}
        </p>
      )}

      {/* Two doors, and neither of them is a code. Play starts a round against
          bots this second; the other opens a room to invite friends into, and
          the platform's own picker does the inviting. A code is what you fall
          back on when the platform cannot introduce two players — inside Usion
          it can. */}
      <div className="space-y-3">
        <button type="button" className="btn-primary" onClick={onSolo} disabled={busy}>
          {t.playSolo}
        </button>
        <button type="button" className="btn-secondary" onClick={onCreate} disabled={busy}>
          {t.playFriends}
        </button>
      </div>
    </div>
  );
}
