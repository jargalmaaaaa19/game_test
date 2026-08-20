import { CHARACTERS, SKIN_TONES, characterDesign } from '@shared/avatars.js';
import { COUNTRIES } from '@shared/countries.js';
import { NAME_MAX_LENGTH } from '@shared/constants.js';
import { t, labelFor } from '../i18n.js';
import Avatar3D from './Avatar3D.jsx';
import Flag from './Flag.jsx';
import AvatarPortrait from './AvatarPortrait.jsx';

/**
 * Pick a character, pick a skin tone, pick a flag. Three decisions, and the
 * first one is made by looking rather than by reading.
 *
 * The characters are shown IN THE PLAYER'S CURRENT TONE rather than each in its
 * own — the gallery is a preview of what you would get, not a poster of who
 * exists, and a tile that changes the skin out from under you when you tap it
 * is a tile that lied. It also makes the two rows read as one decision: change
 * the tone and the whole cast follows.
 *
 * Rendered as radio groups, not selects — a phone select is a modal that hides
 * the very preview the player is judging the choice against. `takenCountries`
 * comes from the room snapshot so a flag another athlete already claimed is
 * visibly unavailable before the server has to say no.
 */
export default function AvatarStudio({ value, onChange, takenCountries = [], showName = true }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const taken = new Set(takenCountries.filter((c) => c !== value.country));
  // The picker stores a character; every renderer wants the design it resolves
  // to. Same resolution the server does when it accepts the identity.
  const design = characterDesign(value.character);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {/* The one place a player studies their character, so this one is live
            and draggable — everywhere else uses a cached portrait. */}
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
          <Avatar3D
            skin={value.skin}
            build={design.build}
            hair={design.hair}
            outfit={design.outfit}
            interactive
            className="h-full w-full"
            title={value.name}
          />
        </div>

        {showName && (
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="athlete-name">
              {t.name}
            </label>
            <input
              id="athlete-name"
              type="text"
              value={value.name}
              maxLength={NAME_MAX_LENGTH}
              placeholder={t.namePlaceholder}
              onChange={(e) => set({ name: e.target.value })}
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3
                         text-base text-neutral-100 outline-none placeholder:text-neutral-600
                         focus:border-neutral-600"
            />
          </div>
        )}
      </div>

      {/* No names under these on purpose — see CHARACTERS in shared/avatars.js.
          They are told apart by how they look, so the tiles are as large as the
          row allows and carry nothing else. */}
      <div>
        <span className="label">{t.characters}</span>
        <div className="grid grid-cols-4 gap-2">
          {CHARACTERS.map((character) => {
            const active = value.character === character.id;
            return (
              <button
                key={character.id}
                type="button"
                aria-pressed={active}
                onClick={() => set({ character: character.id })}
                className={[
                  'grid place-items-center rounded-xl border py-2 transition',
                  active
                    ? 'border-white bg-neutral-800'
                    : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700',
                ].join(' ')}
              >
                <AvatarPortrait
                  skin={value.skin}
                  build={character.build}
                  hair={character.hair}
                  outfit={character.outfit}
                  className="h-16 w-16"
                />
              </button>
            );
          })}
        </div>
      </div>

      <Group label={t.skinTone}>
        {SKIN_TONES.map((tone) => (
          <Swatch
            key={tone.id}
            name="skin"
            checked={value.skin === tone.id}
            onSelect={() => set({ skin: tone.id })}
            label={labelFor(tone.id, tone.label)}
          >
            <span className="h-7 w-7 rounded-full" style={{ backgroundColor: tone.hex }} />
          </Swatch>
        ))}
      </Group>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="label">{t.nationalFlag}</span>
          {taken.size > 0 && (
            <span className="mb-2 text-[11px] text-neutral-600">{t.flagTakenHint}</span>
          )}
        </div>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
          {COUNTRIES.map((country) => {
            const isTaken = taken.has(country.code);
            const checked = value.country === country.code;
            const countryName = labelFor(country.code, country.name);
            return (
              <label
                key={country.code}
                title={countryName}
                className={[
                  'relative grid aspect-square cursor-pointer place-items-center rounded-xl border transition',
                  checked
                    ? 'border-white bg-neutral-800'
                    : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700',
                  isTaken && 'cursor-not-allowed opacity-25',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <input
                  type="radio"
                  name="country"
                  className="sr-only"
                  checked={checked}
                  disabled={isTaken}
                  onChange={() => set({ country: country.code })}
                />
                <Flag code={country.code} className="h-5 w-7" title={countryName} />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Swatch({ name, checked, onSelect, label, children }) {
  return (
    <label
      title={label}
      className={[
        'grid h-12 w-12 cursor-pointer place-items-center rounded-xl border transition',
        checked
          ? 'border-white bg-neutral-800'
          : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700',
      ].join(' ')}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onSelect} />
      {children}
      <span className="sr-only">{label}</span>
    </label>
  );
}
