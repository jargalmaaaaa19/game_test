import { useState } from 'react';
import { ROOM_CODE_LENGTH } from '@shared/constants.js';
import { t, errorText } from '../i18n.js';
import AvatarStudio from './AvatarStudio.jsx';

export default function HomePage({ look, onLookChange, onCreate, onJoin, error, busy }) {
  const [mode, setMode] = useState('idle'); // 'idle' | 'joining'
  const [code, setCode] = useState('');

  const submitJoin = (e) => {
    e.preventDefault();
    if (code.length >= ROOM_CODE_LENGTH) onJoin(code);
  };

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

      {mode === 'idle' ? (
        <div className="space-y-3">
          <button type="button" className="btn-primary" onClick={onCreate} disabled={busy}>
            {t.createRoom}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setMode('joining')}
            disabled={busy}
          >
            {t.joinWithCode}
          </button>
        </div>
      ) : (
        <form onSubmit={submitJoin} className="space-y-3">
          <label className="label" htmlFor="room-code">
            {t.roomCode}
          </label>
          <input
            id="room-code"
            value={code}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            maxLength={ROOM_CODE_LENGTH + 1}
            placeholder={t.enterCode}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-5 py-5
                       text-center font-mono text-3xl tracking-[0.4em] text-neutral-100 outline-none
                       placeholder:text-base placeholder:tracking-normal placeholder:text-neutral-600
                       focus:border-neutral-600"
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || code.length < ROOM_CODE_LENGTH}
          >
            {t.join}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setMode('idle')}>
            {t.cancel}
          </button>
        </form>
      )}
    </div>
  );
}
