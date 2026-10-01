/**
 * What the script sandbox actually gives an author, written as text somebody
 * can read while they are typing.
 *
 * Every line here was checked against the thing it describes rather than
 * against a memory of it: `engine/script/host.mjs` for what is in scope,
 * `engine/script/sandbox.py` for the Node flags, `engine/script/limits.py` for
 * the budget, `flows/views.py` and `bots/views.py` for the two source
 * ceilings. The numbers are restated here rather than fetched because they are
 * a contract the panel states and not data it renders — and a wrong number is
 * worse than no number, since it sends somebody rewriting a script that was
 * never the problem.
 *
 * The snippets are not illustrations. Each was run through the real endpoint,
 * POST /api/flows/script/run/, before it was written down — with the awkward
 * arguments as well as the happy ones: an unanswered question, a string where
 * a number was meant, a date that is not one. A sample that throws the first
 * time somebody presses it teaches them the editor is broken.
 */

/** `bots/views.py::SCRIPT_LIBRARY_LIMIT` — how long this file may be. */
export const LIBRARY_CHAR_LIMIT = 50_000;

/** `flows/views.py::SCRIPT_SOURCE_LIMIT` — how long one block's own code may be. */
export const BLOCK_CHAR_LIMIT = 20_000;

/** Past this the counter appears. Silent until the ceiling is close enough to matter. */
export const COUNTER_FROM = 40_000;

/** One fact: a name to look for in the code, and the sentence that explains it. */
export interface HelpFact {
  /** Printed in mono. What the reader will actually type or see. */
  term: string;
  text: string;
}

/**
 * What is in scope inside a script.
 *
 * `hozir`, the second argument the wrapper in `host.mjs` declares, is
 * deliberately absent: nothing on the Python side ever fills it, so it arrives
 * as `null` on every run. Naming it here would be teaching a variable that is
 * empty — the exact hour-losing kind of wrong this panel exists to prevent.
 */
export const AVAILABLE: HelpFact[] = [
  {
    term: "inputs",
    text: "Blokgacha yig'ilgan hamma narsa: «Savol» bloklari yozgan javoblar, oldingi «Kod» bloklarining natijasi, «HTTP so'rov» javobi (inputs.http). inputs.narx deb o'qiysiz.",
  },
  {
    term: "return",
    text: "Javob shu bilan qaytadi va blok uni o'z o'zgaruvchisiga yozadi. Hech narsa qaytarmasangiz natija bo'sh bo'ladi.",
  },
  {
    term: "console.log(...)",
    text: "Yozgan qiymatingiz blok sinov panelida ko'rinadi. Qiymatni tekshirishning eng qisqa yo'li.",
  },
  {
    term: "Math JSON Date Intl",
    text: "JavaScript'ning o'zi to'liq ishlaydi: matn, son, ro'yxat, obyekt, RegExp, sana. new Date() serverning hozirgi vaqtini beradi.",
  },
  {
    term: "await",
    text: "Ishlaydi, lekin kutadigan narsa yo'q — tarmoq ham, fayl ham yopiq. Hisob-kitob darhol bajariladi.",
  },
  {
    term: "function ...",
    text: "Shu fayldagi funksiya botning har bir «Kod» blokida chaqiriladi. Kutubxonaning butun ma'nosi shu.",
  },
];

/** What the six boundaries in `engine/script/sandbox.py` take away, and why. */
export const FORBIDDEN: HelpFact[] = [
  {
    term: "import  require",
    text: "Modul yuklash butunlay yopiq. Kerakli funksiyani shu faylning o'ziga yozing — u har bir blokka o'zi qo'shiladi.",
  },
  {
    term: "fetch  internet",
    text: "Tarmoq berkitilgan: har qanday so'rov ERR_ACCESS_DENIED bilan qaytadi. Tashqi xizmat kerak bo'lsa — oqimga «HTTP so'rov» bloki qo'ying, javobi keyingi kodga inputs.http bo'lib keladi.",
  },
  {
    term: "fayl  papka  process",
    text: "Skript server fayllarini ko'rmaydi, process.env bo'sh. Kod qayerda ishlayotganini bilmasligi kerak.",
  },
  {
    term: "eval  new Function",
    text: "Matndan kod yasash o'chirilgan. Kodni matn ichida emas, to'g'ridan-to'g'ri yozing.",
  },
  {
    term: "return (kutubxonada)",
    text: "Bu faylda return yozmang. U blokning kodidan oldin ishlaydi va blokni umuman ishga tushirmay to'xtatib qo'yadi. Bu yerda faqat function bo'lsin.",
  },
  {
    term: "saqlab qo'yish",
    text: "Har bir ishga tushish toza boshlanadi — o'zgaruvchi ham, localStorage ham keyingi safarga qolmaydi. Eslab qolish kerak bo'lsa, qiymatni return qiling.",
  },
];

/** The budget, in the numbers a reader can compare their script against. */
export const LIMITS: HelpFact[] = [
  { term: "2 soniya", text: "Mijoz bilan suhbatda. Sinov panelida 8 soniya. Oshsa — kod to'xtatiladi." },
  { term: "64 MB", text: "Xotira." },
  { term: "64 KB", text: "Natija hajmi. Butun ro'yxatni emas, kerakli maydonlarni qaytaring." },
  { term: "50 × 500", text: "console.log: 50 qatorgacha, har biri 500 belgigacha." },
  { term: "50 000 belgi", text: `Shu faylning uzunligi. Bitta blok kodi — ${BLOCK_CHAR_LIMIT.toLocaleString("ru-RU")} belgi.` },
  {
    term: "oddiy qiymatlar",
    text: "Matn, son, true/false, ro'yxat, oddiy obyekt qaytariladi. Map, Set, BigInt va o'ziga havola qiluvchi obyekt qaytmaydi.",
  },
];

/**
 * What to write when the file already has fifty functions in it.
 *
 * This used to be a starter for an empty box — four functions and a header
 * explaining what a library is for. Every new bot now ships with the standard
 * library already in the file (`engine/script/stdlib.js`), so "here is how to
 * begin" answers a question nobody has, and the four it offered are now
 * `discount`, `money`, `date` and `clean` under different names. What is
 * actually unanswered is the next question: how do I put *my* business into
 * this — the districts I deliver to, the services I sell — and the answer is
 * that you write one function that calls the ones already there.
 */
export const STARTER = `// Kutubxonada tayyor funksiyalar bor — «Bu faylda» ro'yxatiga qarang.
// Bu yerga o'zingizga xos narsani yozing: tumanlar, xizmatlar, narxlar.
//
// Blok ularni nomi bilan chaqiradi:
//   return { narx: yetkazish(inputs.summa, inputs.tuman) };
//
// Xabar matnida ham ishlaydi:
//   Yetkazish: {{ money(yetkazish(summa, tuman)) }}
//
// Diqqat: bu faylda return yozmang — u blokni ishga tushirmay to'xtatadi.

// yetkazish(45000, "Chilonzor") -> 15000 · yetkazish(250000, "Chilonzor") -> 0
// Noma'lum tuman -> 30000. Tumanlar va narxlar shu yerda.
function yetkazish(summa, tuman) {
  const bepulChegara = 200000;
  const narxlar = { chilonzor: 15000, yunusobod: 20000, sergeli: 25000 };
  if (num(summa) >= bepulChegara) return 0;
  const kalit = slug(tuman).replace(/-/g, "");
  return narxlar[kalit] === undefined ? 30000 : narxlar[kalit];
}`;

/** One ready-made helper, and the name that says whether it is already in the file. */
export interface Snippet {
  id: string;
  /** What the button says. */
  label: string;
  /** One line under the code, in the reader's terms rather than the code's. */
  hint: string;
  /** The function this declares. Two of the same name in one file is a bug nobody sees. */
  fn: string;
  code: string;
}

/**
 * The pieces — each a whole function, and none of them a copy of the library.
 *
 * The eight that used to be here are all in `stdlib.js` now under their real
 * names: `chegirmali` is `discount`, `pul` is `money`, `sana` is `date`, and so
 * on down the list. Offering them meant offering to add a second `money()` to a
 * file that already had one — legal JavaScript, silently shadowing, and the
 * author would end up editing the copy their blocks do not call. These five are
 * the other thing: business rules the library cannot ship, written the way the
 * library is written and built out of it.
 *
 * Every one was run against the real library through the sandbox before it was
 * written down, with the awkward arguments as well as the happy ones — an
 * unanswered question, a district nobody listed, a time outside working hours.
 * What they answered is in the comments.
 */
export const SNIPPETS: Snippet[] = [
  {
    id: "yetkazish",
    label: "Yetkazish narxi",
    hint: 'Tuman bo\'yicha narx, ma\'lum summadan keyin bepul. yetkazish(45000, "Chilonzor") -> 15000',
    fn: "yetkazish",
    code: `// yetkazish(45000, "Chilonzor") -> 15000 · yetkazish(250000, "Chilonzor") -> 0
// Noma'lum tuman -> 30000. Tumanlar va narxlar shu yerda.
function yetkazish(summa, tuman) {
  const bepulChegara = 200000;
  const narxlar = { chilonzor: 15000, yunusobod: 20000, sergeli: 25000 };
  if (num(summa) >= bepulChegara) return 0;
  const kalit = slug(tuman).replace(/-/g, "");
  return narxlar[kalit] === undefined ? 30000 : narxlar[kalit];
}`,
  },
  {
    id: "xulosa",
    label: "Buyurtma xulosasi",
    hint: "Savatni mijoz o'qiydigan xabarga aylantiradi — ro'yxat, yetkazish, jami.",
    fn: "xulosa",
    code: `// xulosa(savat, "Chilonzor") -> "• Olma × 2 — 24 000 so'm ... Jami: 44 000 so'm"
// cartTotal, money, bulletList va clean — kutubxonadan. yetkazish ham shu
// faylda bo'lishi kerak.
function xulosa(savat, tuman) {
  const qatorlar = toList(savat).map(function (q) {
    return clean(q.nom) + " × " + num(q.soni, 1) + " — " + money(num(q.narx) * num(q.soni, 1));
  });
  const mahsulot = cartTotal(savat);
  const olib = yetkazish(mahsulot, tuman);
  return bulletList(qatorlar) + "\\n\\nMahsulot: " + money(mahsulot) +
    "\\nYetkazish: " + (olib ? money(olib) : "bepul") +
    "\\nJami: " + money(mahsulot + olib);
}`,
  },
  {
    id: "xizmat",
    label: "Javobni variantga bog'lash",
    hint: 'Xato yozilgan javobni ham topadi, raqam bilan ham. xizmatniTop("terapefd", ...) -> "Terapevt"',
    fn: "xizmatniTop",
    code: `// xizmatniTop("terapefd", ["Terapevt","Stomatolog"]) -> "Terapevt"
// xizmatniTop("2", ["Terapevt","Stomatolog"]) -> "Stomatolog" · topilmasa ""
// Bo'sh javob — oqimda «tushunmadim» yo'nalishini chizish uchun.
function xizmatniTop(javob, royxat) {
  const topildi = closest(javob, royxat);
  if (topildi) return topildi;
  const raqam = extractNumbers(javob)[0];
  const variantlar = toList(royxat);
  if (raqam >= 1 && raqam <= variantlar.length) return variantlar[raqam - 1];
  return "";
}`,
  },
  {
    id: "qabul",
    label: "Qabul vaqti",
    hint: "Sana va vaqtni mijoz yozganidek o'qiydi, ish vaqtiga solishtiradi. Tashqarida bo'lsa — bo'sh.",
    fn: "qabulVaqti",
    code: `// qabulVaqti("ertaga", "14:30") -> "2026-09-04 14:30"
// qabulVaqti("ertaga", "23:00") -> "" — ish vaqtidan tashqari
// qabulVaqti("salom", "14:30") -> "" — sana tushunilmadi
function qabulVaqti(sanaMatni, vaqtMatni) {
  const kun = parseDateUz(sanaMatni);
  const soat = parseTimeUz(vaqtMatni);
  if (!kun || !soat) return "";
  const toliq = kun + " " + soat;
  return isWorkingHours(toliq) ? toliq : "";
}`,
  },
  {
    id: "navbat",
    label: "Navbat raqami",
    hint: 'Mijozga aytiladigan qisqa raqam. navbatRaqami("Terapevt") -> "TER-K7QP"',
    fn: "navbatRaqami",
    code: `// navbatRaqami("Terapevt") -> "TER-K7QP" · nomsiz xizmatga "NVB-..."
// Adashtiradigan harflar yo'q (randomId): 0/O va 1/I aralashmaydi.
function navbatRaqami(xizmat) {
  const bosh = slug(xizmat).replace(/-/g, "").slice(0, 3).toUpperCase() || "NVB";
  return bosh + "-" + randomId().slice(0, 4);
}`,
  },
];

/**
 * Whether this helper is already in the file.
 *
 * By declaration and not by name anywhere: a file whose header comment mentions
 * `pul` would otherwise refuse to insert `pul`. Two declarations of one name in
 * the same scope is legal JavaScript and the second silently wins, so nothing
 * would look wrong until a block called the version the author had edited and
 * got the one they had not.
 */
export function alreadyHas(source: string, fn: string): boolean {
  return new RegExp(`(^|[^\\w$])function\\s+${fn}\\s*\\(`).test(source);
}

/**
 * `source` with `code` on the end, separated by one blank line.
 *
 * Appended rather than inserted at the caret, because a helper dropped into the
 * middle of the function somebody is halfway through typing is a syntax error
 * they did not make. The end of the file is where a function may always go.
 */
export function append(source: string, code: string): string {
  const body = source.replace(/\s+$/, "");
  return body ? `${body}\n\n${code}\n` : `${code}\n`;
}
