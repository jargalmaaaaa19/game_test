import { BUILDS, HAIRSTYLES, OUTFITS, PRESETS, SKIN_TONES } from '@shared/avatars.js';
import { COUNTRIES } from '@shared/countries.js';
import { NAME_MAX_LENGTH } from '@shared/constants.js';
import { t, labelFor } from '../i18n.js';
import Avatar3D from './Avatar3D.jsx';
import Flag from './Flag.jsx';
import AvatarPortrait from './AvatarPortrait.jsx';

/**
 * Avatar customization: a preset gallery, then skin tone, hairstyle, outfit and
 * national flag.
 *
 * Rendered as radio groups, not selects — a phone select is a modal that hides
 * the very preview the player is judging the choice against. `takenCountries`
 * comes from the room snapshot so a flag another athlete already claimed is
 * visibly unavailable before the server has to say no.
 */
export default function AvatarStudio({ value, onChange, takenCountries = [], showName = true }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const taken = new Set(takenCountries.filter((c) => c !== value.country));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {/* The one place a player studies their character, so this one is live
            and draggable — everywhere else uses a cached portrait. */}
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
          <Avatar3D
            skin={value.skin}
            build={value.build}
            hair={value.hair}
            outfit={value.outfit}
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

      {/* One tap to a finished character — three pickers is a lot to face when
          your friends are already waiting in the hall. */}
      <div>
        <span className="label">{t.presets}</span>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((preset) => {
            const active =
              value.skin === preset.skin &&
              value.hair === preset.hair &&
              value.outfit === preset.outfit &&
              value.build === preset.build;
            return (
              <button
                key={preset.id}
                type="button"
                title={labelFor(preset.id, preset.label)}
                onClick={() =>
                  set({ skin: preset.skin, hair: preset.hair, outfit: preset.outfit, build: preset.build })
                }
                className={[
                  'flex flex-col items-center rounded-xl border py-1.5 transition',
                  active
                    ? 'border-white bg-neutral-800'
                    : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700',
                ].join(' ')}
              >
                <AvatarPortrait
                  skin={preset.skin}
                  build={preset.build}
                  hair={preset.hair}
                  outfit={preset.outfit}
                  className="h-12 w-12"
                />
                <span className="mt-0.5 truncate px-1 text-[10px] text-neutral-400">
                  {labelFor(preset.id, preset.label)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Group label={t.build}>
        {BUILDS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => set({ build: b.id })}
            className={[
              'rounded-xl border px-4 py-2 text-sm transition',
              value.build === b.id
                ? 'border-white bg-neutral-800 text-white'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700',
            ].join(' ')}
          >
            {labelFor(b.id, b.label)}
          </button>
        ))}
      </Group>

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

      <Group label={t.hairstyle}>
        {HAIRSTYLES.map((style) => (
          <Swatch
            key={style.id}
            name="hair"
            checked={value.hair === style.id}
            onSelect={() => set({ hair: style.id })}
            label={labelFor(style.id, style.label)}
            wide
          >
            <AvatarPortrait skin={value.skin} build={value.build} hair={style.id} outfit={value.outfit} className="h-11 w-11" />
          </Swatch>
        ))}
      </Group>

      <Group label={t.outfitStyle}>
        {OUTFITS.map((outfit) => (
          <Swatch
            key={outfit.id}
            name="outfit"
            checked={value.outfit === outfit.id}
            onSelect={() => set({ outfit: outfit.id })}
            label={labelFor(outfit.id, outfit.label)}
            wide
          >
            <AvatarPortrait skin={value.skin} build={value.build} hair={value.hair} outfit={outfit.id} className="h-11 w-11" />
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

function Swatch({ name, checked, onSelect, label, children, wide = false }) {
  return (
    <label
      title={label}
      className={[
        'grid cursor-pointer place-items-center rounded-xl border transition',
        wide ? 'h-14 w-14' : 'h-12 w-12',
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
