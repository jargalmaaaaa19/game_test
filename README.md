# Usion Olympics — server

Room-code lobby + match director for a 2–10 player, five-event Olympic party
game. Node 20+, Socket.IO, no database — rooms live in process memory.

```bash
npm install
cp .env.example .env                                   # then fill it in
npm run dev                                            # loads .env (Node >=20.12)
node tools/smoke.mjs                                   # 23-check E2E on the three lobby flows
```

`npm start` does NOT read `.env` — deliberately. A host injects real environment
variables, and a `.env` that silently overrode them in production would be a
very quiet way to ship the wrong configuration.

Client (React + Tailwind, Vite):

```bash
cd client && npm install && npm run dev     # http://localhost:5173
```

`VITE_SERVER_URL` points the client at the room server (default
`http://localhost:3200`).

## Layout

```
shared/     pure rules — imported by the server sim AND the client renderer
  rng.js         seeded RNG; every match-shaping decision runs through it
  scoring.js     placements -> points -> medal table
  avatars.js     skin tones, outfits, faces — ids are the wire format
  countries.js   flags
  events/        sports catalog + the programme draw + the sim contract
client/src/ React + Tailwind UI
  i18n.js        mn/en strings — Mongolian by default, host may switch it
  net/           the socket + the mirrored room snapshot
  components/    Athlete (inline SVG), AvatarStudio, HomePage, LobbyPage
server/src/
  index.js       http + socket.io bootstrap, sweeper, graceful shutdown
  auth.js        Usion RS256 access-token verification against the platform JWKS
  handlers.js    every socket event; the only file that touches a socket
  room.js        one party: roster, identity, ready, snapshot
  store.js       room registry, code index, grace-window sweeper
  phases.js      HALL -> INTRO -> PLAY -> PODIUM -> CEREMONY
  identity.js    name/face/outfit/flag validation + flag arbitration
  roomCode.js    code generation and normalization
```

`shared/` must never import from `server/` or `client/`. Two copies of the rules
is how a game desyncs.

## Wire protocol

All client→server events take an optional ack callback and resolve to
`{ok: true, ...}` or `{ok: false, error: {code, message}}`. Codes are stable —
see `ERROR` in `shared/constants.js`.

| Client → server | Payload | Notes |
|---|---|---|
| `room:create` | `{name?, maxPlayers?}` | → `{code, roomId, playerId, state}`; caller becomes host |
| `room:join` | `{code, playerId?, name?}` | `playerId` reclaims a seat after a reconnect |
| `room:leave` | — | |
| `player:identity` | `{name?, face?, outfit?, country?}` | hall only; partial patches allowed |
| `player:ready` | `{ready}` | hall only |
| `game:start` | — | host only |
| `game:rematch` | — | host only, ceremony only |
| `game:input` | event-specific | fire-and-forget, no ack, rate-limited to 40/s |
| `dev:finish_event` | `{placements}` | only when `DEV_TOOLS=true` |

| Server → client | When |
|---|---|
| `catalog` | on connect — faces, outfits, countries, sports, limits |
| `room:state` | any roster/phase change (full snapshot, carries `version`) |
| `game:started` | kickoff: `{seed, programme, lanes, competitors}` |
| `game:intro` / `game:play` / `game:podium` / `game:ceremony` | phase entry |
| `game:snapshot` | 20 Hz during `play`, only while a sim is loaded |
| `game:rematch` / `game:aborted` | back to the hall |

## How a match is decided

`startMatch` generates one seed and broadcasts it. Both the five-sport draw and
the lane assignment derive from it (`shared/rng.js`), so a reconnecting client
rebuilds the programme without asking anyone, and lane 1 is never simply "the
player who created the room". `drawProgramme` prefers an unused input scheme on
each pick, so five events feel like five different games rather than five
tapping contests.

Scoring has exactly one seam: an event reports `placements` (player ids, best
first) and `shared/scoring.js` turns that into points and the medal table. Time
events, distance events and last-standing events all score identically.

## The 100m Dash (`sprint_100m`)

Alternate left/right as fast as you can hold a rhythm; Space alternates for you
so a one-key masher is still playable.

Three positions exist for your own runner and they are kept apart on purpose:

| | who owns it | when |
|---|---|---|
| **server** | `shared/events/sprint_100m.js` on the authority | 20 Hz, arrives late |
| **predicted** | the SAME module, run in the browser on your taps | this frame |
| **drawn** | predicted, eased toward the server (snapped past 5 m) | every frame |

Remote runners are never predicted — they are interpolated ~100 ms in the past
(`client/src/net/interpolation.js`). The animation loop writes transforms
directly to DOM nodes; nothing about a race touches React state.

**Tap-spam is beaten by economics, not by a rate limit.** Impulse scales with
the gap since your last step, so impulse-per-second saturates and tapping twice
as fast buys nothing; a step that lands inside `MIN_STEP_INTERVAL_MS` breaks the
stride and restarts the clock, so a held key never completes a step at all. A
bare "ignore steps under 45 ms" was tried first and handed a script the perfect
cadence — it won the first end-to-end run. Both rules are regression-pinned in
`tools/sprint.test.mjs`.

```bash
node tools/sprint.test.mjs                       # pure sim, no server
DEV_TOOLS=true DEV_PROGRAMME=sprint_100m npm start
node tools/sprint.e2e.mjs                        # three cadences over real sockets
```

## The 3D avatar

`client/src/avatar3d/` — a chibi athlete built from spheres, capsules and one
torus. Nothing is loaded: no GLB, no textures, no fonts. The platform strips
externally-fetched assets at deploy, and a party game that waits on model
downloads over a phone connection starts late.

Engine: **Babylon.js 9.16.1 from `https://usions.com/vendor/`** — the pinned,
platform-hosted runtime is the only 3D engine a Usion app may load (three.js is
not permitted, and any other CDN is stripped). Havok is deliberately not loaded:
the avatars are rendered, not simulated, so there is no physics and no
iOS &lt; 16.4 WASM cliff.

**Proportions are the design.** The head is ~55% of total height and the legs
are barely there — a band of skin and a rounded trainer under the hem. Realistic
proportions on a 40px lobby card read as a stick; a big head reads as a face.

**Build is its own axis, deliberately.** `b_soft` / `b_broad` drives both the
silhouette (shoulder width, hip taper, hem height, how much leg shows, limb
thickness) and the face (brow weight, blush, jaw, eye shape). It is separate
from hair and clothing on purpose: tying a jaw to a haircut would mean a player
who wants long hair cannot have a broad face, and a player in a blazer is forced
into one. Two buttons, one row.

The face carries the read almost entirely through **brows and blush** — thick,
low and level versus thin, high and arched; rosy cheeks or none. On a face with
no nose those two do more than any amount of geometry.

**Four axes, and the outfit is a shape, not a colour.** `skin` (6) × `hair` (8:
long, bob, curly, pigtails, ponytail, short, buzz, beard) × `outfit` (8: dress,
top &amp; skirt, tee &amp; jeans, hoodie, blazer, tracksuit, overalls, crop &amp; shorts).
Each outfit `kind` drives real geometry — a dress flares from the waist, a
hoodie has a hood bulge and a kangaroo pocket, jeans colour the legs, a blazer
shows a shirt placket — because a colour swap alone produces eight identical
characters in eight paints. `PRESETS` ships eight finished looks (four read
feminine, four masculine) that between them use every hairstyle and every
outfit exactly once, so a player who does not want three pickers still arrives
as somebody.

Three construction rules, each of which fixed something that looked wrong:

- **The body is ONE tapered cylinder**, not a shirt stacked on shorts. Two
  stacked pieces read as a waistline, and a waistline on a character this round
  makes it look like it is wearing a dress. Definition comes from a collar
  torus, which does not cut the silhouette.
- **Arms hang from a shoulder node swung forward** (`rotation.x ≈ 0.92`), so the
  limb stays tight against the body and the wrist ends up buried inside the hand
  ball. The camera sees a sleeve and then a mitten out front — no floating
  forearm, no visible joint.
- **Trainers are white.** The UI behind these characters is near-black; dark
  shoes on a dark card amputate the feet.

**Ten avatars, one WebGL context.** Ten live canvases is ten contexts on a
mid-range Android, where browsers cap out around 8–16 and start evicting. So
lists do not render 3D at all: one offscreen engine draws each distinct look
once (`portraits.js`), hands back a PNG data URL, and the cards are plain
`<img>`. A look repeated across players costs nothing the second time. Only two
places are live: the avatar studio and the champion on the victory card.

`Athlete.jsx` (flat SVG) stays as the fallback and holds the same box until a
portrait resolves — so no layout shift, and no holes if WebGL is unavailable.

Two mistakes worth not repeating, both caught only by looking at the output:

- `scene.render()` outside a render loop draws **nothing** — Babylon's loop
  wraps each frame in `beginFrame`/`endFrame`, and a scene is not renderable on
  the frame it is built (shaders compile first). Every portrait came back fully
  transparent until `renderPortrait` awaited `scene.executeWhenReady`.
- `CreateSphere`'s `slice` measures **down from the north pole**, so a hair cap
  past ~0.4 reaches the equator — where the eyes are. The first eight portraits
  were faceless dark helmets.

## Flags are drawn, not emoji

`client/src/components/Flag.jsx`. Regional-indicator emoji (🇲🇳) have **no glyph
on Windows** — the OS falls back to the bare letter pair, so the picker rendered
as a grid reading "MN JP KR" and flag-as-identity collapsed. Android and iOS
render them fine, which is exactly why it is easy to ship this broken.

Each flag is a short list of primitives (bands, circles, stars, polys) drawn at
a 3:2 viewBox and simplified to read at ~24px: the colour layout plus one
dominant emblem. They are not heraldically exact and are not meant to be. A
hairline border keeps the mostly-white ones from vanishing on a dark card, and
an unknown code falls back to a plain slate plate rather than a hole.

The victory **share text** still carries emoji flags on purpose: that string
leaves the device for other people's clients, which are overwhelmingly phones.

## Closing ceremony

`client/src/components/CeremonyScreen.jsx` — podium, victory share card, the
full match table, and the platform's records boards.

Two platform calls happen here and they are easy to confuse:

| call | means | who calls it |
|---|---|---|
| `leaderboard.submit(points)` | "my best ever" — feeds Game Center and the *«Name» beat your record* notification | every client, for itself |
| `game.reportResult({winnerId, standings, scores})` | "here is how THIS match went" — drops a result card into the chat the game started from | the host, once |

Both are required; neither replaces the other. Both are gated behind a `useRef`,
not a state flag — a re-render must never file a second result card.

**Medals carry rank three ways** (`components/Medal.jsx`): metal colour, the
numeral, and a different ribbon cut per place. Colour alone fails for the ~8% of
men with a colour vision deficiency, for whom gold and bronze are nearly the
same swatch.

**The share card is text, not a rendered image.** `Usion.share('text', {…})`
takes a content type; text pastes into any chat, survives every client, and
needs no canvas export. `net/usion.js` falls back to `navigator.share`, then the
clipboard, and reports which path actually ran so the button never claims a
success it did not achieve.

⚠️ `reportResult` is documented for **2–8 players** and this game seats 10. Above
8, `net/usion.js` reports the winner without `standings` rather than risk a
rejected payload, and logs that it did. Raise the registry's cap and that branch
can go.

```bash
node tools/share.test.mjs    # the share string, asserted rather than eyeballed
```

Everything behind `isEmbedded()` — `submit`, `friends`/`top`, `reportResult`,
`Usion.share` — is **unverified outside the Usion host**, where those paths do
not run at all. Test them in the app before shipping.

## Archery (`archery`)

Two taps per arrow, three arrows each, one shared set of three winds. The first
tap locks the **angle** off a marker sweeping across the target; the second
locks **power** off a gauge sweeping up and down. Score is the ring the arrow
lands in — 10 at the bullseye down to 1 at the rim, 0 off the target.

**The client sends the value it saw; the server bounds it.** Sampling the sweep
purely on the server would charge every player their ping — you release on the
bullseye and score a 7. Trusting the client outright would let a modded one send
`0.72` every time. So `applyInput` accepts the reported value only when it is
within one plausible round trip of its own reading of the same pure sweep
function, and otherwise substitutes its own. Both sides evaluate `aimAt` /
`powerAt` from `stageAt`, a **server** timestamp carried in the snapshot.

**Discrete state does not live on `requestAnimationFrame`.** The sweeps do —
they are animation, and a player cannot aim at a marker they cannot see. But
scores, arrows, wind and the clock run on a 150 ms interval, because a hidden
tab stops rAF dead while an interval only slows down. Driving everything from
the frame loop froze the entire scoreboard at zero the moment the tab lost
focus, which is exactly what a backgrounded WebView does.

```bash
node tools/archery.test.mjs                    # pure sim, no server
DEV_TOOLS=true DEV_PROGRAMME=archery npm start
node tools/archery.e2e.mjs                     # three strategies over real sockets
```

## Long Jump (`long_jump`)

Three phases per attempt, three attempts, **best counts**: tap to build speed
down a 38 m runway, press and HOLD on or just before the red board, release when
the dial reads about 45°.

Distance is plain projectile range (`v²·sin 2θ / g`), so **45° really is optimal
rather than merely asserted** — the dial is a physics readout, not a lucky
number. Gravity is tuned rather than Earth's, which puts a perfect jump at
~8.5 m and a casual one at 4–6 m.

**Measurement starts at the board, not at the foot.** Taking off early costs you
exactly the gap you left behind, which is the whole reason "just before the
line" is a skill rather than a formality. Two ways to foul, both worth zero:
pressing jump past the board, and running through it without committing at all
— otherwise a player could simply never commit and never risk anything.

The run-up reuses the sprint's lesson: impulse per second saturates and a tap
inside `MIN_STEP_INTERVAL_MS` breaks the stride, so holding the button down
builds no speed. The released angle is bounded server-side exactly as archery's
is.

```bash
node tools/longjump.test.mjs                     # pure sim, no server
DEV_TOOLS=true DEV_PROGRAMME=long_jump npm start
node tools/longjump.e2e.mjs                      # 45° vs flat vs serial fouler
```

## 50m Freestyle (`freestyle_swim`)

A rhythm event. Cues arrive on a 480 ms beat, each calling for a LEFT or RIGHT
stroke; hit the beat and you pull, miss it and the water takes your speed. The
stroke pattern mostly alternates, with the odd doubled side drawn from the match
seed, so it has to be read rather than drummed.

**Hammering both buttons is beaten by economics, not a rate limit** — the same
lesson the sprint taught. Only the next unresolved cue can be struck, and only
once; a press with no cue in range is a *splash* and costs speed. Rate-limiting
the button instead would just hand a script the maximum legal stroke rate.

Two bugs the tests caught, both real:

- **Every timing inside a window must still finish the 50m.** At the original
  `ok` impulse a barely-in-window swimmer covered ~35 m before the round expired
  and simply watched the clock — that is a punishment, not a difficulty curve.
- **The beat helpers took a "state" object.** The sim calls the field `startsAt`;
  the wire snapshot calls it `s`. So `beatTime(snapshot, i)` silently returned
  `NaN` on the client: no cues rendered and every stroke judged as a splash. They
  now take the number, which makes the mismatch impossible to write.

Stale cues are expired inside `applyInput` as well as `step`, so a press landing
between ticks is judged against the cue that is actually live rather than one the
server has not got round to retiring. The client likewise derives the visible cue
from the clock, not only from the server's pointer, which lags by a tick plus a
latency — most of a 70 ms window.

```bash
node tools/swim.test.mjs                              # pure sim, no server
DEV_TOOLS=true DEV_PROGRAMME=freestyle_swim npm start
node tools/swim.e2e.mjs                               # on-beat vs late vs idle
```

## Adding a sport

1. Add a descriptor to `EVENT_CATALOG` in `shared/events/index.js`.
2. Copy `shared/events/_template.js` to `shared/events/<id>.js` and implement it
   (`sprint_100m.js` is the worked example).
3. Register a renderer in `EVENT_SCREENS` in `client/src/App.jsx`.

The sim and the screen land independently: a sport with a sim but no screen
still runs, and a sport with neither resolves on the overtime clock.

`phases.js` imports it lazily by id. A catalog entry with no module still plays:
its heat resolves on the overtime clock and is flagged `unsimulated`, so the
lobby, the programme, the podium and the medal table are all playable before the
sims exist.

## Deploying

**Two hosts, not one.** Vercel serves the client; it cannot run the room server.
Vercel's functions are serverless and cannot hold a WebSocket open, and this
game is a Socket.IO server with rooms living in process memory. The server needs
a host that runs a long-lived process — Railway, Render, Fly.

### Client → Vercel

`vercel.json` at the repo root already carries the build:

```json
"buildCommand": "cd client && npm install && npm run build",
"outputDirectory": "client/dist"
```

Deploy from the **repo root**, not from `client/`. The client imports `@shared/*`
from outside its own folder, so a build scoped to `client/` as the root
directory cannot see the rules modules and fails.

Set `VITE_SERVER_URL` in the Vercel project to the room server's public URL. It
is baked in at build time, so changing it needs a redeploy.

### Server → Railway (or anything with a real process)

```bash
cd server && npm start        # honours PORT
```

Required environment:

| var | why |
|---|---|
| `PORT` | supplied by the platform |
| `CORS_ORIGINS` | must list the Vercel domain, or every socket is refused |
| `USION_AUTH_REQUIRED` | leave ON in production; without it a room code is enough to join as anyone |
| `NODE_ENV=production` | what `USION_AUTH_REQUIRED` defaults from |

`DEV_TOOLS` and `DEV_PROGRAMME` must be **off** in production — they let any
client resolve a heat and force the programme.

## Operational notes

- **Auth is on by default in production** (`USION_AUTH_REQUIRED` derives from
  `NODE_ENV`). Without it a room code is enough to join as anyone. Register this
  service with `realtime.connection_mode: "direct"` so clients mint an access
  token via `Usion.game._fetchDirectAccess()` before dialling.
- **Single process.** Rooms are in memory; every player in a room must land on
  the same node. Horizontal scale needs sticky sessions plus a Socket.IO Redis
  adapter.
- **Two grace windows.** A player who drops mid-match keeps their seat and their
  points for `DISCONNECT_GRACE_MS` (20 s); an empty room survives
  `EMPTY_ROOM_GRACE_MS` (60 s), so one bad network moment does not destroy a
  live tournament. A match that falls below two connected players aborts to the
  hall rather than freezing on a track nobody is running.
- **Send something downstream while a room idles.** Socket.IO's ping/pong covers
  this, but proxies (Railway included) kill silently-downstream connections after
  ~60 s — do not lengthen `pingInterval` past that.

## Not built yet

- Nine of the thirteen sport simulations. Four are done, and between them they
  cover every shape the contract has to support: `sprint_100m` (real-time,
  host-stepped), `archery` (turn-taking, event-driven), `long_jump`
  (multi-phase, hold-and-release) and `freestyle_swim` (rhythm, judged against a
  beat grid). The rest have catalog entries only and resolve on the overtime
  clock behind `PendingEventScreen`.
- In-game chat (quick phrases + free text) — required by the platform for every
  multiplayer game; rides `realtime`, never `Usion.chat.sendMessage`.
- Bot fill for solo launches. `Room.addPlayer` already takes `isBot`; gate the
  fill on an env flag **and check it at the call site**.
- The platform-relay entry path (chat invite → `config.roomId`), which is how
  most players will actually arrive. The room-code lobby is the second door.
