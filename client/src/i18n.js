// Mongolian is the default; English is the fallback. Never hardcode a
// user-facing string in a component — the platform reports the user's language
// through Usion.getLanguage() and the host can change it under us.

const mn = {
  appName: 'Усион Олимп',
  tagline: '2–10 тамирчин · 4 төрөл · нэг медалийн хүснэгт',

  playSolo: 'Тоглох',
  playFriends: 'Найзуудтайгаа тоглох',
  inviteFriends: 'Найзаа урих',
  inviting: 'Урьж байна…',
  inviteHint: 'Найзаа урьвал тэр шууд өрөөнд орно',
  inviteHintWeb: 'Аппаас гадуур урих боломжгүй — кодоо хуваалцаарай',
  joiningInvite: 'Урилгаар өрөөнд орж байна…',
  startingSolo: 'Тэмцээн эхэлж байна…',
  // The name a player who never opened the picker races under. Without it the
  // server calls them Athlete 1 — the same series it gives the bots — and they
  // cannot find themselves on any scoreboard.
  youAthlete: 'Та',
  cancel: 'Болих',
  copied: 'Хуулагдлаа',

  myAthlete: 'Миний тамирчин',
  edit: 'Өөрчлөх',
  done: 'Болсон',
  name: 'Нэр',
  namePlaceholder: 'Нэрээ бичнэ үү',
  skinTone: 'Арьсны өнгө',
  characters: 'Дүр сонгох',
  nationalFlag: 'Улсын туг',
  flagTakenHint: 'Сонгогдсон тугийг дахин сонгох боломжгүй',

  lobby: 'Хүлээх танхим',
  athletes: 'Тамирчид',
  host: 'Зохион байгуулагч',
  ready: 'Бэлэн',
  notReady: 'Бэлэн биш',
  imReady: 'Би бэлэн',
  cancelReady: 'Бэлдэхээ болих',
  startGame: 'Тэмцээнийг эхлүүлэх',
  waitingForHost: 'Зохион байгуулагч эхлүүлэхийг хүлээж байна…',
  waitingForPlayers: 'Дор хаяж 2 тамирчин хэрэгтэй',
  waitingForReady: 'Бүгд бэлэн болоогүй байна',
  emptySeat: 'Хоосон',
  leaveRoom: 'Өрөөнөөс гарах',
  offline: 'Салсан',
  reconnecting: 'Дахин холбогдож байна…',
  connecting: 'Холбогдож байна…',
  playersCount: (n, max) => `${n}/${max} тамирчин`,

  getReady: 'Бэлтгэ',
  go: 'ГАРАА!',
  falseStart: 'Эрт хөдөллөө!',
  leftFoot: 'ЗҮҮН',
  rightFoot: 'БАРУУН',
  sprintHint: 'Хоёр эрхийгээ ээлжлэн хурдан дар. Нэг хуруугаа давтвал удаашрана',
  wind: 'Салхи',
  windLeft: 'З',
  windRight: 'Б',
  timer: 'Хугацаа',
  remaining: 'Үлдсэн',
  shots: (n) => `${n} сум`,
  ljJumpBtn: 'ҮСРЭХ',
  ljFoul: 'Амжилтгүй',
  speed: 'Хурд',
  swimL: 'ЗҮҮН',
  swimR: 'БАРУУН',
  swimHint: 'Эхний сумны талыг дар — хүлээх шаардлагагүй, буруу дарвал хурд буурна',
  swimDistance: (x, total) => `${x} / ${total}м`,
  swimCombo: (n) => `${n} дараалан`,
  // Two mistakes in a row and the water is taking real speed back; the lane
  // says so in words, because "the swimmer feels heavy" is not something a
  // player can read off a 3D pool.
  swimSlowing: 'УДААШИРЛАА',
  swimJudge: {
    perfect: 'ТӨГС!', good: 'САЙН', ok: 'ХЭТ ХУРДАН',
    wrong: 'БУРУУ ТАЛ',
  },
  eventOf: (i, total) => `${i}/${total} төрөл`,
  results: 'Дүн',
  medalTable: 'Медалийн хүснэгт',
  points: 'оноо',
  place: (n) => `${n}-р байр`,
  // The badge over a leader's head mid-race has a runner's width to live in,
  // so it gets the short form — never `place`.
  placeShort: (n) => `${n}-р`,
  mps: 'м/с',
  secs: (v) => `${v}с`,
  lane: (n) => `${n}-р зам`,
  finalStandings: 'Эцсийн байр',
  champion: 'Аварга',
  shareVictory: 'Ялалтаа хуваалцах',
  shared: 'Хуваалцлаа',
  shareUnavailable: 'Хуваалцах боломжгүй байна',
  friendsBoard: 'Найзууд',
  globalBoard: 'Дэлхий',
  yourBest: 'Таны амжилт',
  noRecords: 'Одоогоор бичлэг алга',
  playAgain: 'Дахин тоглох',
  nextEvent: 'Дараагийн төрөл…',
  comingSoon: 'Энэ төрөл удахгүй нэмэгдэнэ',
  autoAdvance: 'Хугацаа дуусмагц дараагийн төрөл рүү шилжинэ',
  matchAborted: 'Тэмцээн зогслоо',

  // Catalog labels live here, not in shared/: those modules are the wire format
  // the server validates against, and an id must never depend on a language.
  labels: {
    sk_1: 'Цайвар', sk_2: 'Элсэн', sk_3: 'Зөгийн бал',
    sk_4: 'Хүрэл', sk_5: 'Хүрэн', sk_6: 'Бараан',

    MN: 'Монгол', JP: 'Япон', KR: 'Өмнөд Солонгос', CN: 'Хятад', US: 'АНУ',
    BR: 'Бразил', DE: 'Герман', FR: 'Франц', GB: 'Их Британи', IT: 'Итали',
    ES: 'Испани', NL: 'Нидерланд', SE: 'Швед', NO: 'Норвеги', PL: 'Польш',
    TR: 'Турк', RU: 'Орос', KZ: 'Казахстан', IN: 'Энэтхэг', ID: 'Индонез',
    VN: 'Вьетнам', TH: 'Тайланд', PH: 'Филиппин', AU: 'Австрали',
    NZ: 'Шинэ Зеланд', CA: 'Канад', MX: 'Мексик', AR: 'Аргентин',
    ZA: 'ӨАБНУ', EG: 'Египет', NG: 'Нигери', KE: 'Кени',
  },

  errors: {
    ROOM_NOT_FOUND: 'Ийм кодтой өрөө олдсонгүй',
    ROOM_FULL: 'Өрөө дүүрсэн байна',
    ROOM_LOCKED: 'Тэмцээн аль хэдийн эхэлсэн байна',
    ALREADY_IN_ROOM: 'Та аль хэдийн өрөөнд байна',
    NOT_IN_ROOM: 'Та өрөөнд байхгүй байна',
    NOT_HOST: 'Зөвхөн зохион байгуулагч эхлүүлнэ',
    TOO_FEW_PLAYERS: 'Дор хаяж 2 тамирчин хэрэгтэй',
    NOT_EVERYONE_READY: 'Бүгд бэлэн болоогүй байна',
    FLAG_TAKEN: 'Энэ тугийг өөр тамирчин сонгосон байна',
    INVALID_INPUT: 'Буруу утга илгээлээ',
    RATE_LIMITED: 'Түр хүлээнэ үү',
    UNAUTHENTICATED: 'Нэвтрэлт баталгаажсангүй',
    WRONG_PHASE: 'Одоо энэ үйлдлийг хийх боломжгүй',
    NETWORK: 'Сервертэй холбогдож чадсангүй',
  },
};

const en = {
  appName: 'Usion Olympics',
  tagline: '2–10 athletes · 4 events · one medal table',

  playSolo: 'Play',
  playFriends: 'Play with friends',
  inviteFriends: 'Invite friends',
  inviting: 'Inviting…',
  inviteHint: 'They join the room straight from the invite',
  inviteHintWeb: 'Invites need the Usion app — share the code instead',
  joiningInvite: 'Joining the room you were invited to…',
  startingSolo: 'Starting your race…',
  youAthlete: 'You',
  cancel: 'Cancel',
  copied: 'Copied',

  myAthlete: 'My athlete',
  edit: 'Edit',
  done: 'Done',
  name: 'Name',
  namePlaceholder: 'Your name',
  skinTone: 'Skin tone',
  characters: 'Choose a character',
  nationalFlag: 'National flag',
  flagTakenHint: 'A flag already taken cannot be picked again',

  lobby: 'Waiting hall',
  athletes: 'Athletes',
  host: 'Host',
  ready: 'Ready',
  notReady: 'Not ready',
  imReady: "I'm ready",
  cancelReady: 'Not ready',
  startGame: 'Start the games',
  waitingForHost: 'Waiting for the host to start…',
  waitingForPlayers: 'At least 2 athletes needed',
  waitingForReady: 'Not everyone is ready',
  emptySeat: 'Empty',
  leaveRoom: 'Leave room',
  offline: 'Offline',
  reconnecting: 'Reconnecting…',
  connecting: 'Connecting…',
  playersCount: (n, max) => `${n}/${max} athletes`,

  getReady: 'Get set',
  go: 'GO!',
  falseStart: 'False start!',
  leftFoot: 'LEFT',
  rightFoot: 'RIGHT',
  sprintHint: 'Tap the corners with alternating thumbs — the same one twice slows you down',
  wind: 'Wind',
  windLeft: 'L',
  windRight: 'R',
  timer: 'Timer',
  remaining: 'Remaining',
  shots: (n) => `${n} shots`,
  ljJumpBtn: 'JUMP',
  ljFoul: 'Failed',
  speed: 'Speed',
  swimL: 'LEFT',
  swimR: 'RIGHT',
  swimHint: 'Answer the arrow on the line — no waiting; a wrong side costs speed',
  swimDistance: (x, total) => `${x} / ${total}m`,
  swimCombo: (n) => `${n} in a row`,
  swimSlowing: 'SLOWING',
  swimJudge: {
    perfect: 'PERFECT!', good: 'GOOD', ok: 'RUSHED',
    wrong: 'WRONG SIDE',
  },
  eventOf: (i, total) => `event ${i}/${total}`,
  results: 'Results',
  medalTable: 'Medal table',
  points: 'pts',
  place: (n) => `#${n}`,
  placeShort: (n) => ['1st', '2nd', '3rd'][n - 1] ?? `${n}th`,
  mps: 'm/s',
  secs: (v) => `${v}s`,
  lane: (n) => `lane ${n}`,
  finalStandings: 'Final standings',
  champion: 'Champion',
  shareVictory: 'Share the win',
  shared: 'Shared',
  shareUnavailable: 'Sharing unavailable',
  friendsBoard: 'Friends',
  globalBoard: 'Global',
  yourBest: 'Your best',
  noRecords: 'No records yet',
  playAgain: 'Play again',
  nextEvent: 'Next event…',
  comingSoon: 'This sport is coming soon',
  autoAdvance: 'Moves on to the next event when the clock runs out',
  matchAborted: 'Match stopped',

  // English falls through to the catalog's own labels.
  labels: {},

  errors: {
    ROOM_NOT_FOUND: 'No room with that code',
    ROOM_FULL: 'That room is full',
    ROOM_LOCKED: 'That match has already started',
    ALREADY_IN_ROOM: 'You are already in a room',
    NOT_IN_ROOM: 'You are not in a room',
    NOT_HOST: 'Only the host can start',
    TOO_FEW_PLAYERS: 'At least 2 athletes needed',
    NOT_EVERYONE_READY: 'Not everyone is ready',
    FLAG_TAKEN: 'Another athlete already took that flag',
    INVALID_INPUT: 'Invalid value',
    RATE_LIMITED: 'Slow down a moment',
    UNAUTHENTICATED: 'Not authenticated',
    WRONG_PHASE: 'You cannot do that right now',
    NETWORK: 'Could not reach the server',
  },
};

const BUNDLES = { mn, en };

// Mongolian is the default. `navigator.language` is deliberately never
// consulted — a Mongolian player on a phone shipped with an English locale
// should still get Mongolian — and neither is `Usion.getLanguage()` on its own:
// the SDK loads outside the Usion app too and then just echoes the browser.
// Only a real host config (from `Usion.init`) may switch the language.
export let lang = 'mn';
export let t = BUNDLES.mn;

/** Called once from boot, with the config the host handed us (null if standalone). */
export function setLanguage(hostConfig) {
  if (!hostConfig) return lang;
  const code = String(hostConfig.language || window.Usion?.getLanguage?.() || 'mn')
    .slice(0, 2)
    .toLowerCase();
  if (BUNDLES[code]) {
    lang = code;
    t = BUNDLES[code];
  }
  return lang;
}

/** Server error codes are stable; unknown ones fall back to the raw message. */
export const errorText = (error) =>
  (error && (t.errors[error.code] || error.message)) || t.errors.NETWORK;

/** Localized label for a catalog id (skin, outfit, face, country code). */
export const labelFor = (id, fallback = '') => t.labels[id] || fallback;
