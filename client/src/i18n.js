// Mongolian is the default; English is the fallback. Never hardcode a
// user-facing string in a component — the platform reports the user's language
// through Usion.getLanguage() and the host can change it under us.

const mn = {
  appName: 'Усион Олимп',
  tagline: '2–10 тамирчин · 4 төрөл · нэг медалийн хүснэгт',

  createRoom: 'Өрөө үүсгэх',
  joinWithCode: 'Кодоор нэгдэх',
  roomCode: 'Өрөөний код',
  enterCode: 'Кодоо оруулна уу',
  join: 'Нэгдэх',
  cancel: 'Болих',
  copied: 'Хуулагдлаа',
  tapToCopy: 'Дарж хуулна уу',

  myAthlete: 'Миний тамирчин',
  edit: 'Өөрчлөх',
  done: 'Болсон',
  name: 'Нэр',
  namePlaceholder: 'Нэрээ бичнэ үү',
  skinTone: 'Арьсны өнгө',
  build: 'Бие бялдар',
  hairstyle: 'Үс засалт',
  outfitStyle: 'Хувцасны загвар',
  presets: 'Бэлэн дүр',
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
  archeryAim: 'Онилоод сум харва',
  archeryLoose: 'ХАРВА',
  archeryDone: 'Гурван сум дууслаа',
  archeryHint: 'Джойстикоор онил — салхины эсрэг чиглүүлээрэй',
  power: 'Хүч',
  wind: 'Салхи',
  arrowsLeft: (n) => `${n} сум үлдсэн`,
  ljRun: 'Хоёр эрхийгээ ээлжлэн дар — хурдал',
  ljAngle: 'Барьж байгаад 45°-д тавь',
  ljFlight: 'Нисэж байна…',
  ljDone: 'Гурван оролдлого дууслаа',
  ljHint: 'Самбар дээр даран барь, 45°-д тавь',
  ljHoldBtn: 'ДЭЛГЭЦИЙГ ДАРААД БАРЬ',
  ljToBoard: 'самбар хүртэл',
  ljMeasured: 'хэмжсэн урт',
  ljBest: 'шилдэг үзүүлэлт',
  ljPerfect: 'ТӨГС ҮСРЭЛТ!',
  ljOverstep: 'зураас давлаа',
  ljAttempt: (n, total) => `${n}/${total} оролдлого`,
  speed: 'Хурд',
  swimL: 'ЗҮҮН',
  swimR: 'БАРУУН',
  swimHint: 'Тэмдэг гарангуут тохирох талыг аль болох хурдан дар',
  swimDistance: (x, total) => `${x} / ${total}м`,
  swimCombo: (n) => `${n} дараалан`,
  swimJudge: {
    perfect: 'ТӨГС!', good: 'САЙН', ok: 'БОЛЖ БАЙНА',
    miss: 'АЛДЛАА', wrong: 'БУРУУ ТАЛ', splash: 'ЭРТ',
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

    b_soft: 'Нарийн', b_broad: 'Бүдүүн',

    h_long: 'Урт үс', h_bob: 'Боб', h_curly: 'Буржгар', h_pigtails: 'Хос сүлжээ',
    h_ponytail: 'Морин сүүл', h_short: 'Богино', h_buzz: 'Тайрсан', h_beard: 'Сахалтай',

    o_dress: 'Даашинз', o_skirt: 'Юбка', o_jeans: 'Жинс', o_hoodie: 'Худи',
    o_blazer: 'Пиджак', o_track: 'Пүүз хувцас', o_overalls: 'Комбинзон',
    o_crop: 'Кроп & шорт',

    pr_1: 'Луна', pr_2: 'Саара', pr_3: 'Номи', pr_4: 'Энхэ',
    pr_5: 'Бат', pr_6: 'Тэмү', pr_7: 'Ганзо', pr_8: 'Дорж',

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

  createRoom: 'Create room',
  joinWithCode: 'Join with code',
  roomCode: 'Room code',
  enterCode: 'Enter your code',
  join: 'Join',
  cancel: 'Cancel',
  copied: 'Copied',
  tapToCopy: 'Tap to copy',

  myAthlete: 'My athlete',
  edit: 'Edit',
  done: 'Done',
  name: 'Name',
  namePlaceholder: 'Your name',
  skinTone: 'Skin tone',
  build: 'Build',
  hairstyle: 'Hairstyle',
  outfitStyle: 'Outfit',
  presets: 'Presets',
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
  archeryAim: 'Aim, then loose',
  archeryLoose: 'LOOSE',
  archeryDone: 'All three arrows away',
  archeryHint: 'Drag anywhere to aim — lean into the wind',
  power: 'Power',
  wind: 'Wind',
  arrowsLeft: (n) => `${n} arrows left`,
  ljRun: 'Run — alternate your thumbs',
  ljAngle: 'Hold, and release at 45°',
  ljFlight: 'In the air…',
  ljDone: 'All three attempts used',
  ljHint: 'Press and hold on the board, release at 45°',
  ljHoldBtn: 'PRESS AND HOLD ANYWHERE',
  ljToBoard: 'to the board',
  ljMeasured: 'measured',
  ljBest: 'best jump',
  ljPerfect: 'PERFECT TAKE-OFF!',
  ljOverstep: 'over the line',
  ljAttempt: (n, total) => `attempt ${n}/${total}`,
  speed: 'Speed',
  swimL: 'LEFT',
  swimR: 'RIGHT',
  swimHint: 'The moment a cue shows, hit that side as fast as you can',
  swimDistance: (x, total) => `${x} / ${total}m`,
  swimCombo: (n) => `${n} in a row`,
  swimJudge: {
    perfect: 'PERFECT!', good: 'GOOD', ok: 'OK',
    miss: 'MISS', wrong: 'WRONG SIDE', splash: 'EARLY',
  },
  eventOf: (i, total) => `event ${i}/${total}`,
  results: 'Results',
  medalTable: 'Medal table',
  points: 'pts',
  place: (n) => `#${n}`,
  placeShort: (n) => ['1st', '2nd', '3rd'][n - 1] ?? `${n}th`,
  mps: 'm/s',
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
