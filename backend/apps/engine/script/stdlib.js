/*
 * Bot kutubxonasi — har bir «Kod» bloki va har bir {{ ifoda }} shu fayldan
 * boshlanadi. 54 ta tayyor funksiya: pul, sana, telefon, ro'yxat va mijozning
 * javobini tushunish. Blokda ham, xabar matnida ham nomi bilan chaqiriladi:
 *
 *   const jami = cartTotal(inputs.savat);   ·   {{ money(cartTotal(savat)) }}
 *
 * Uchta qoida — o'z funksiyangizni ham shu qoida bo'yicha yozing:
 *
 *   1. Hech bir funksiya XATO BERMAYDI. Noto'g'ri qiymatga bo'sh satr, 0 yoki
 *      bo'sh ro'yxat qaytadi. Sababi: {{ ifoda }} ichidagi xato mijozning
 *      xabarida bo'sh joyga aylanadi va uni hech kim ko'rmaydi. Javobsiz
 *      savol, son o'rniga matn, sana bo'lmagan sana — hammasi tinch o'tadi.
 *   2. Bu faylda `return` yozilmaydi: u blok kodidan OLDIN ishlaydi va blokni
 *      umuman ishga tushirmay to'xtatib qo'yadi. Faqat `function`.
 *   3. Funksiya nomlari inglizcha, izohlar o'zbekcha. Nomni o'zgartirsangiz,
 *      uni chaqirayotgan bloklar ham o'zgarishi kerak — muharrir saqlashda
 *      «funksiya topilmadi» deb ogohlantiradi.
 *
 * `_` bilan boshlanadigan nomlar ichki yordamchilar; ularni chaqirmang.
 */

// ─── Son va pul ──────────────────────────────────────────────────────────────

// num("12 000 so'm") -> 12000 · num("1,5") -> 1.5 · num("salom") -> 0. Ikkinchi
// argument — hech narsa chiqmasa qaytadigan qiymat. "1.500" ming emas, 1.5 deb
// o'qiladi: nuqta bizda kasrni ajratadi, minglik esa bo'shliq bilan yoziladi.
function num(qiymat, zaxira) {
  const orqaga = typeof zaxira === "number" && Number.isFinite(zaxira) ? zaxira : 0;
  if (typeof qiymat === "number") return Number.isFinite(qiymat) ? qiymat : orqaga;
  if (typeof qiymat === "boolean") return qiymat ? 1 : 0;
  if (qiymat === null || qiymat === undefined) return orqaga;
  // Ro'yxat va obyekt son emas: `String([1,2])` «1,2» beradi, bu esa 12 emas.
  if (typeof qiymat === "object") return orqaga;

  let matn = String(qiymat).replace(/ /g, " ").trim();
  if (!matn) return orqaga;
  const manfiy = /^[-−]/.test(matn);
  matn = matn.replace(/[^0-9.,]/g, "");
  if (!matn) return orqaga;

  const nuqta = matn.lastIndexOf(".");
  const vergul = matn.lastIndexOf(",");
  if (nuqta !== -1 && vergul !== -1) {
    // Ikkalasi ham bor: oxirgisi kasr belgisi, boshqasi minglik.
    matn = nuqta > vergul ? matn.replace(/,/g, "") : matn.replace(/\./g, "").replace(",", ".");
  } else if (vergul !== -1) {
    const nechta = (matn.match(/,/g) || []).length;
    const keyin = matn.length - vergul - 1;
    matn = nechta === 1 && keyin >= 1 && keyin <= 2 ? matn.replace(",", ".") : matn.replace(/,/g, "");
  } else if (nuqta !== -1 && (matn.match(/\./g) || []).length > 1) {
    matn = matn.replace(/\./g, "");
  }

  const chiqdi = Number.parseFloat(matn);
  if (!Number.isFinite(chiqdi)) return orqaga;
  return manfiy ? -Math.abs(chiqdi) : chiqdi;
}

// money(150000) -> "150 000 so'm" · money(7, "XTR") -> "7 XTR" · money(x, "") -> son
// Butun songa yaxlitlanadi: so'mning tiyini yo'q, Telegram Stars ham butun.
function money(summa, valyuta) {
  const butun = Math.round(num(summa));
  const belgi = valyuta === undefined || valyuta === null ? "so'm" : String(valyuta).trim();
  const matn = _minglik(Math.abs(butun));
  const oldi = butun < 0 ? "-" : "";
  return belgi ? oldi + matn + " " + belgi : oldi + matn;
}

/* discount(12000, 15) -> 10200. Foiz 0 dan 100 gacha qisiladi. */
function discount(summa, foiz) {
  const butun = num(summa);
  const kamayish = Math.min(Math.max(num(foiz), 0), 100);
  return Math.round(butun - (butun * kamayish) / 100);
}

/* markup(12000, 15) -> 13800. Ustama — chegirmaning teskarisi, yuqori chegarasiz. */
function markup(summa, foiz) {
  const butun = num(summa);
  const ortish = Math.max(num(foiz), 0);
  return Math.round(butun + (butun * ortish) / 100);
}

// roundTo(12345, 1000) -> 12000 · roundTo(1.2345, 0.01) -> 1.23 · qadamsiz — oddiy
// yaxlitlash. Kasr qadamda 0.1 + 0.2 muammosi chiqmasin deb natija qadam qancha
// xonali bo'lsa, shuncha xonaga qaytariladi.
function roundTo(qiymat, qadam) {
  const butun = num(qiymat);
  const bosqich = Math.abs(num(qadam));
  if (!bosqich) return Math.round(butun);
  const chiqdi = Math.round(butun / bosqich) * bosqich;
  const xona = (String(bosqich).split(".")[1] || "").length;
  return xona ? Number(chiqdi.toFixed(Math.min(xona, 10))) : chiqdi;
}

/* percentOf(25, 200) -> 12.5 — «qism butunning necha foizi». Butun 0 bo'lsa 0. */
function percentOf(qism, butun) {
  const hammasi = num(butun);
  if (!hammasi) return 0;
  return Math.round((num(qism) / hammasi) * 10000) / 100;
}

/* Bo'sh katak — «bir yuz» emas, «yuz»; «bir o'n» emas, «o'n» degani. */
const _BIRLIK = ["", "bir", "ikki", "uch", "to'rt", "besh", "olti", "yetti", "sakkiz", "to'qqiz"];
const _ONLIK = ["", "o'n", "yigirma", "o'ttiz", "qirq", "ellik", "oltmish", "yetmish", "sakson", "to'qson"];
const _DARAJA = ["", "ming", "million", "milliard", "trillion"];

// numberToWords(12500) -> "o'n ikki ming besh yuz" — hisob-faktura uchun.
// O'zbekchada «bir ming» deyilmaydi (1000 shunchaki «ming»), «bir million» esa
// aytiladi: «bir» faqat ming darajasida tushib qoladi. 0 -> "nol", manfiy ->
// "minus …", juda katta son -> bo'sh satr.
function numberToWords(qiymat) {
  let qoldiq = Math.round(num(qiymat));
  if (!Number.isFinite(qoldiq) || Math.abs(qoldiq) > Number.MAX_SAFE_INTEGER) return "";
  if (qoldiq === 0) return "nol";
  const oldi = qoldiq < 0 ? "minus " : "";
  qoldiq = Math.abs(qoldiq);

  const guruhlar = [];
  while (qoldiq > 0) {
    guruhlar.push(qoldiq % 1000);
    qoldiq = Math.floor(qoldiq / 1000);
  }
  if (guruhlar.length > _DARAJA.length) return "";

  const sozlar = [];
  for (let daraja = guruhlar.length - 1; daraja >= 0; daraja--) {
    if (!guruhlar[daraja]) continue;
    const bosh = guruhlar[daraja] === 1 && daraja === 1 ? "" : _uchlik(guruhlar[daraja]);
    sozlar.push((bosh + " " + _DARAJA[daraja]).trim());
  }
  return oldi + sozlar.join(" ");
}

/* 0..999 so'z bilan — numberToWords ichidagi bitta guruh. */
function _uchlik(butun) {
  const qismlar = [];
  const yuzlik = Math.floor(butun / 100);
  const qoldiq = butun % 100;
  if (yuzlik) qismlar.push(yuzlik === 1 ? "yuz" : _BIRLIK[yuzlik] + " yuz");
  if (Math.floor(qoldiq / 10)) qismlar.push(_ONLIK[Math.floor(qoldiq / 10)]);
  if (qoldiq % 10) qismlar.push(_BIRLIK[qoldiq % 10]);
  return qismlar.join(" ");
}

/* 1250000 -> "1 250 000" */
function _minglik(butun) {
  return String(butun).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// ─── Sana va vaqt ────────────────────────────────────────────────────────────
//
// Bitta qoida: HECH QANDAY argumentsiz chaqirsangiz — «hozir». Argument berib,
// u bo'sh yoki noto'g'ri bo'lsa — bo'sh satr. Ya'ni date() bugungi sanani
// beradi, date(javobsiz_savol) esa bo'sh satrni. Aks holda javobsiz savol
// mijozning xabarida bugungi sanaga aylanib qolardi, buni esa hech kim sezmaydi.

/* Server vaqti. `hozir` — sandbox bergan qiymat (host.mjs); bo'lmasa Date. */
function _hozir() {
  return typeof hozir !== "undefined" && hozir instanceof Date && !Number.isNaN(hozir.getTime())
    ? new Date(hozir.getTime())
    : new Date();
}

function _ikki(butun) {
  return String(butun).padStart(2, "0");
}

/* "YYYY-MM-DD" — mahalliy vaqt bo'yicha, toISOString emas. */
function _iso(kuni) {
  return kuni.getFullYear() + "-" + _ikki(kuni.getMonth() + 1) + "-" + _ikki(kuni.getDate());
}

function _kunQosh(kuni, nechta) {
  const yangi = new Date(kuni.getTime());
  yangi.setDate(yangi.getDate() + nechta);
  return yangi;
}

/* Kunning boshi — soatni tashlab, faqat sanani solishtirish uchun. */
function _kunBoshi(kuni) {
  return new Date(kuni.getFullYear(), kuni.getMonth(), kuni.getDate());
}

/* Yil-oy-kundan Date. Bo'lmagan sana (31.02) null beradi, keyingi oyga o'tmaydi. */
function _sanaYasa(yili, oyi, kuni) {
  if (!(oyi >= 1 && oyi <= 12) || !(kuni >= 1 && kuni <= 31)) return null;
  const chiqdi = new Date(yili, oyi - 1, kuni);
  if (chiqdi.getFullYear() !== yili || chiqdi.getMonth() !== oyi - 1 || chiqdi.getDate() !== kuni) return null;
  return chiqdi;
}

/*
 * toDate("27.08.2026") -> Date · toDate("salom") -> null
 *
 * Har qanday ko'rinishdagi sanani Date ga aylantiradi: Date, son, ISO,
 * 27.08.2026, 27/08/26, 2026-08-27. Boshqa sana funksiyalari shu yerdan
 * boshlanadi.
 *
 * Ikkita nozik joy. "2026-08-27" ni JavaScript UTC deb hisoblaydi va sana
 * serverning vaqt mintaqasiga qarab bir kunga siljib ketadi, shuning uchun u
 * alohida o'qiladi. Kichik son esa sana emas: `new Date(0)` 1970-yilni beradi,
 * ya'ni to'ldirilmagan raqamli maydon mijozning xabarida «01.01.1970» bo'lib
 * chiqardi — ishonch bilan aytilgan noto'g'ri sana.
 */
function toDate(qiymat) {
  if (qiymat instanceof Date) return Number.isNaN(qiymat.getTime()) ? null : new Date(qiymat.getTime());
  if (typeof qiymat === "number") {
    // 1e8 dan boshlab soniya (Telegram `message.date`), 1e11 dan millisekund.
    if (!Number.isFinite(qiymat) || Math.abs(qiymat) < 1e8) return null;
    const chiqdi = new Date(Math.abs(qiymat) < 1e11 ? qiymat * 1000 : qiymat);
    return Number.isNaN(chiqdi.getTime()) ? null : chiqdi;
  }
  if (typeof qiymat !== "string") return null;

  const xom = qiymat.trim();
  if (!xom) return null;

  let topildi = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(xom);
  if (topildi) return _sanaYasa(Number(topildi[1]), Number(topildi[2]), Number(topildi[3]));

  topildi = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/.exec(xom);
  if (topildi) {
    let yili = Number(topildi[3]);
    if (yili < 100) yili += yili < 70 ? 2000 : 1900;
    return _sanaYasa(yili, Number(topildi[2]), Number(topildi[1]));
  }

  const chiqdi = new Date(xom);
  return Number.isNaN(chiqdi.getTime()) ? null : chiqdi;
}

/* date() -> bugun · date("2026-08-27") -> "27.08.2026" · date("x") -> "" */
function date(qiymat, ajratgich) {
  const kuni = arguments.length === 0 ? _hozir() : toDate(qiymat);
  if (!kuni) return "";
  const bel = ajratgich === undefined || ajratgich === null ? "." : String(ajratgich);
  return _ikki(kuni.getDate()) + bel + _ikki(kuni.getMonth() + 1) + bel + kuni.getFullYear();
}

/* time() -> "14:30". Sanada soat bo'lmasa "00:00". */
function time(qiymat) {
  const kuni = arguments.length === 0 ? _hozir() : toDate(qiymat);
  if (!kuni) return "";
  return _ikki(kuni.getHours()) + ":" + _ikki(kuni.getMinutes());
}

/* dateTime() -> "03.09.2026 14:30" */
function dateTime(qiymat) {
  const kuni = arguments.length === 0 ? _hozir() : toDate(qiymat);
  if (!kuni) return "";
  return date(kuni) + " " + time(kuni);
}

const _HAFTA = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const _OYLAR = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

/* weekday("2026-08-27") -> "payshanba" */
function weekday(qiymat) {
  const kuni = arguments.length === 0 ? _hozir() : toDate(qiymat);
  return kuni ? _HAFTA[kuni.getDay()] : "";
}

/* monthName(8) -> "avgust" · monthName("2026-08-27") -> "avgust" */
function monthName(qiymat) {
  // 1..12 — oy raqami. Millisekund sifatida u 1970-yilning boshini bildirardi,
  // ya'ni hech kim yozmaydigan qiymatni.
  if (typeof qiymat === "number" && Number.isInteger(qiymat) && qiymat >= 1 && qiymat <= 12) {
    return _OYLAR[qiymat - 1];
  }
  const kuni = arguments.length === 0 ? _hozir() : toDate(qiymat);
  return kuni ? _OYLAR[kuni.getMonth()] : "";
}

// addDays("2026-08-27", 3) -> "2026-08-30" · addDays(3) -> bugundan 3 kun keyin
// Natija "YYYY-MM-DD"; ko'rinishini date() bilan o'zgartirasiz.
function addDays(qiymat, kunlar) {
  if (arguments.length === 0) return _iso(_hozir());
  if (arguments.length === 1 && typeof qiymat === "number") {
    return _iso(_kunQosh(_hozir(), Math.round(num(qiymat))));
  }
  const kuni = toDate(qiymat);
  return kuni ? _iso(_kunQosh(kuni, Math.round(num(kunlar)))) : "";
}

// daysBetween("2026-08-27", "2026-09-03") -> 7 · daysBetween(muddat) -> o'tgan kunlar
// Ikkinchi sanani bermasangiz «hozir». Soat hisobga olinmaydi: kechqurun 23:00
// dan ertalab 01:00 gacha bir kun.
function daysBetween(birinchi, ikkinchi) {
  const bosh = toDate(birinchi);
  const oxir = ikkinchi === undefined || ikkinchi === null || ikkinchi === "" ? _hozir() : toDate(ikkinchi);
  if (!bosh || !oxir) return 0;
  return Math.round((_kunBoshi(oxir).getTime() - _kunBoshi(bosh).getTime()) / 86400000);
}

// isPast("2020-01-01") -> true · isPast("salom") -> false. Soatsiz sana kun
// bo'yicha solishtiriladi — bugungi sana o'sha kuni ertalab hali o'tmagan
// hisoblanadi; soati bor sana esa aniq vaqt bo'yicha.
function isPast(qiymat) {
  const kuni = toDate(qiymat);
  if (!kuni) return false;
  const hozirgi = _hozir();
  const soatsiz = kuni.getHours() === 0 && kuni.getMinutes() === 0 && kuni.getSeconds() === 0;
  return soatsiz
    ? _kunBoshi(kuni).getTime() < _kunBoshi(hozirgi).getTime()
    : kuni.getTime() < hozirgi.getTime();
}

// isWorkingHours() -> hozir ish vaqtimi · isWorkingHours(vaqt, 10, 19)
// Dushanbadan jumagacha, sukut bo'yicha 9:00–18:00.
function isWorkingHours(qiymat, boshi, oxiri) {
  const kuni = arguments.length === 0 ? _hozir() : toDate(qiymat);
  if (!kuni) return false;
  if (kuni.getDay() === 0 || kuni.getDay() === 6) return false;
  const soati = kuni.getHours() + kuni.getMinutes() / 60;
  return soati >= num(boshi, 9) && soati < num(oxiri, 18);
}

// nextWorkingDay() -> keyingi ish kuni "YYYY-MM-DD". Berilgan kundan KEYINGI:
// juma kuni chaqirilsa dushanbani beradi.
function nextWorkingDay(qiymat) {
  const kuni = arguments.length === 0 ? _hozir() : toDate(qiymat);
  if (!kuni) return "";
  let keyingi = _kunQosh(_kunBoshi(kuni), 1);
  while (keyingi.getDay() === 0 || keyingi.getDay() === 6) keyingi = _kunQosh(keyingi, 1);
  return _iso(keyingi);
}

// ─── Matn ────────────────────────────────────────────────────────────────────

// clean("  Ali   Vali  ") -> "Ali Vali" — ortiqcha bo'shliq ketadi, uzunligi
// cheklanadi. Odam yozgan javobni saqlashdan oldin har doim shu.
function clean(qiymat, uzunlik) {
  if (qiymat === null || qiymat === undefined || typeof qiymat === "object") return "";
  const chek = Math.max(1, Math.round(num(uzunlik, 200)));
  return String(qiymat).replace(/\s+/g, " ").trim().slice(0, chek);
}

/* titleCase("ali vali") -> "Ali Vali" · titleCase("o'ktam") -> "O'ktam" */
function titleCase(qiymat) {
  return String(qiymat ?? "")
    .toLowerCase()
    .replace(/(^|[\s\-–—])(\p{L})/gu, (butun, oldi, harf) => oldi + harf.toUpperCase());
}

// truncate("uzun matn…", 20) -> "uzun matn…". Kesish so'z o'rtasidan emas, yaqin
// bo'shliqdan — `sender.fit` xabarni Telegram chegarasiga sig'dirganda ham shunday.
function truncate(qiymat, uzunlik, dumi) {
  const toza = String(qiymat ?? "").trim();
  const chek = Math.max(1, Math.round(num(uzunlik, 100)));
  const dum = dumi === undefined || dumi === null ? "…" : String(dumi);
  if (toza.length <= chek) return toza;
  const joy = chek - dum.length;
  if (joy <= 0) return dum.slice(0, chek);
  let kesik = toza.slice(0, joy);
  const bosh = kesik.lastIndexOf(" ");
  if (bosh > 0 && bosh >= joy - 20) kesik = kesik.slice(0, bosh);
  return kesik.replace(/\s+$/, "") + dum;
}

/* Kirill harflari lotinchaga — slug() uchun. Ruscha ы, ь, ъ ham bor. */
const _KIRIL = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

// slug("Salom, Dunyo!") -> "salom-dunyo" · slug("Тошкент") -> "toshkent"
// Havola, fayl nomi va tashqi tizimga yuboriladigan kalit uchun.
function slug(qiymat) {
  let lotin = "";
  for (const harf of String(qiymat ?? "").toLowerCase()) lotin += _KIRIL[harf] ?? harf;
  return lotin
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* lines("a\n\nb") -> ["a", "b"] — bo'sh qatorlar tashlanadi. */
function lines(qiymat) {
  return String(qiymat ?? "")
    .split(/\r?\n/)
    .map((qator) => qator.trim())
    .filter((qator) => qator !== "");
}

// mask("998901234567") -> "99********67" · mask(karta, 4, 4) -> "8600********1234"
// Mijozga o'z ma'lumotini ko'rsatishda. Juda qisqa qiymat butunlay yopiladi.
function mask(qiymat, boshi, oxiri, belgi) {
  const xom = String(qiymat ?? "").trim();
  if (!xom) return "";
  const bosh = Math.max(0, Math.round(num(boshi, 2)));
  const oxir = Math.max(0, Math.round(num(oxiri, 2)));
  const yulduz = belgi === undefined || belgi === null ? "*" : String(belgi).slice(0, 1) || "*";
  if (xom.length <= bosh + oxir) return yulduz.repeat(xom.length);
  return xom.slice(0, bosh) + yulduz.repeat(xom.length - bosh - oxir) + xom.slice(xom.length - oxir);
}

// ─── O'zbekiston ─────────────────────────────────────────────────────────────

// phone("+998 90 123-45-67") -> "998901234567" · phone("salom") -> ""
// 9 xonaliga 998 qo'shiladi, 0 dan boshlangan 10 xonalidan nol tushadi. Boshqa
// uzunlik — bo'sh satr, ya'ni «bu telefon emas».
function phone(qiymat) {
  const raqamlari = String(qiymat ?? "").replace(/\D/g, "");
  if (raqamlari.length === 9) return "998" + raqamlari;
  if (raqamlari.length === 12 && raqamlari.startsWith("998")) return raqamlari;
  if (raqamlari.length === 10 && raqamlari.startsWith("0")) return "998" + raqamlari.slice(1);
  return "";
}

/* phonePretty("998901234567") -> "+998 90 123 45 67" */
function phonePretty(qiymat) {
  const raqamlari = phone(qiymat);
  if (!raqamlari) return "";
  return (
    "+" + raqamlari.slice(0, 3) + " " + raqamlari.slice(3, 5) + " " +
    raqamlari.slice(5, 8) + " " + raqamlari.slice(8, 10) + " " + raqamlari.slice(10)
  );
}

/* isPhone("90 123 45 67") -> true. «Telefonni tekshirish» shartlari uchun. */
function isPhone(qiymat) {
  return phone(qiymat) !== "";
}

/* Operator kodlari. Yangisi chiqsa shu ro'yxatga qo'shiladi. */
const _OPERATORLAR = {
  90: "Beeline", 91: "Beeline",
  93: "Ucell", 94: "Ucell",
  95: "Uzmobile", 99: "Uzmobile",
  97: "Mobiuz", 20: "Mobiuz",
  88: "Humans", 33: "Humans",
  98: "Perfectum",
};

/* operator("998901234567") -> "Beeline". Noma'lum kodga bo'sh satr. */
function operator(qiymat) {
  const raqamlari = phone(qiymat);
  return raqamlari ? _OPERATORLAR[raqamlari.slice(3, 5)] || "" : "";
}

// ─── Tekshirish ──────────────────────────────────────────────────────────────

// isEmpty("   ") -> true · isEmpty([]) -> true · isEmpty(0) -> false
// «Javob berilmadimi» degan savolning javobi. Nol va false — javob, bo'sh emas.
function isEmpty(qiymat) {
  if (qiymat === null || qiymat === undefined) return true;
  if (typeof qiymat === "string") return qiymat.trim() === "";
  if (Array.isArray(qiymat)) return qiymat.length === 0;
  if (typeof qiymat === "object") return Object.keys(qiymat).length === 0;
  return false;
}

/* isEmail("ali@sunrise.uz") -> true. Bitta @, nuqtali domen, bo'shliqsiz. */
function isEmail(qiymat) {
  const xom = String(qiymat ?? "").trim();
  if (!xom || xom.length > 254 || /\s/.test(xom)) return false;
  return /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(xom);
}

/* isDate("27.08.2026") -> true · isDate("31.02.2026") -> false */
function isDate(qiymat) {
  return toDate(qiymat) !== null;
}

// oneOf("terapevt", ["Terapevt", "Stomatolog"]) -> true. Katta-kichik harf,
// apostrof va ortiqcha bo'shliq hisobga olinmaydi. Xato bilan yozilgan javob
// uchun closest() ga qarang.
function oneOf(qiymat, royxat) {
  const kaliti = _kalit(qiymat);
  if (!kaliti) return false;
  return toList(royxat).some((variant) => _kalit(_matn(variant)) === kaliti);
}

// ─── Ro'yxat va savat ────────────────────────────────────────────────────────

// toList("olma, anor") -> ["olma", "anor"] · toList(null) -> []
// Matn qator ko'chirish, vergul yoki nuqtali vergul bo'yicha bo'linadi. Boshqa
// hamma ro'yxat funksiyalari shu yerdan boshlanadi — ularga null berish xavfsiz.
function toList(qiymat) {
  if (Array.isArray(qiymat)) return qiymat.slice();
  if (qiymat === null || qiymat === undefined) return [];
  if (typeof qiymat === "string") {
    const xom = qiymat.trim();
    if (!xom) return [];
    const bolgich = xom.includes("\n") ? /\r?\n/ : xom.includes(",") ? "," : xom.includes(";") ? ";" : null;
    if (!bolgich) return [xom];
    return xom.split(bolgich).map((bolak) => bolak.trim()).filter((bolak) => bolak !== "");
  }
  return [qiymat];
}

/* sum([1, "2", "uch"]) -> 3 · sum(qatorlar, "narx") -> narxlar yig'indisi */
function sum(royxat, kaliti) {
  return toList(royxat).reduce((yigindi, element) => {
    return yigindi + num(kaliti === undefined || kaliti === null ? element : get(element, kaliti, 0));
  }, 0);
}

// cartTotal([{narx: 12000, soni: 2}, {narx: 5000}]) -> 29000 — narx × soni;
// soni yozilmagan qator bitta deb olinadi. Maydon nomlari boshqacha bo'lsa:
// cartTotal(savat, "price", "qty").
function cartTotal(qatorlar, narxKaliti, soniKaliti) {
  const narxNomi = narxKaliti === undefined || narxKaliti === null ? "narx" : String(narxKaliti);
  const soniNomi = soniKaliti === undefined || soniKaliti === null ? "soni" : String(soniKaliti);
  return toList(qatorlar).reduce((yigindi, qator) => {
    if (!qator || typeof qator !== "object") return yigindi + num(qator);
    const xom = get(qator, soniNomi, null);
    const nechta = xom === null || xom === "" ? 1 : num(xom);
    return yigindi + num(get(qator, narxNomi, 0)) * nechta;
  }, 0);
}

// groupBy(buyurtmalar, "holat") -> { yangi: [...], yopilgan: [...] }
// Kalit o'rniga funksiya ham bo'ladi: groupBy(list, (x) => x.narx > 100000).
function groupBy(royxat, kaliti) {
  // Prototipsiz obyekt: mijoz javobidan kelgan "__proto__" kalit sifatida
  // yozilsa oddiy obyektning prototipini almashtirib yuborardi.
  const guruhlar = Object.create(null);
  for (const element of toList(royxat)) {
    const nomi = String(typeof kaliti === "function" ? safe(() => kaliti(element), "") : get(element, kaliti, ""));
    if (!guruhlar[nomi]) guruhlar[nomi] = [];
    guruhlar[nomi].push(element);
  }
  return guruhlar;
}

/* sortBy(mahsulotlar, "narx") · uchinchi argument true bo'lsa kamayish bo'yicha. */
function sortBy(royxat, kaliti, kamayish) {
  const nusxa = toList(royxat);
  const teskari = kamayish === true || String(kamayish).toLowerCase() === "desc";
  nusxa.sort((birinchi, ikkinchi) => {
    const chap = kaliti === undefined || kaliti === null ? birinchi : get(birinchi, kaliti, "");
    const ong = kaliti === undefined || kaliti === null ? ikkinchi : get(ikkinchi, kaliti, "");
    return _solishtir(chap, ong);
  });
  return teskari ? nusxa.reverse() : nusxa;
}

/* Ikkalasi ham son bo'lsa son bo'yicha, aks holda matn bo'yicha. */
function _solishtir(chap, ong) {
  if (_sonmi(chap) && _sonmi(ong)) return num(chap) - num(ong);
  return String(chap ?? "").localeCompare(String(ong ?? ""));
}

function _sonmi(qiymat) {
  if (typeof qiymat === "number") return Number.isFinite(qiymat);
  if (typeof qiymat !== "string" || !qiymat.trim()) return false;
  return /^[+\-−]?[\d\s.,]+$/.test(qiymat.trim());
}

// bulletList(["olma", "anor"]) -> "• olma\n• anor". Telegramda jadval yo'q —
// telefon ekranida ustunlar buziladi, ro'yxat esa o'qiladi. Obyektlardan
// nom/name/title kabi maydon olinadi.
function bulletList(royxat, belgi) {
  const nuqtasi = belgi === undefined || belgi === null ? "• " : String(belgi);
  return toList(royxat)
    .map((element) => _matn(element))
    .filter((bolak) => bolak !== "")
    .map((bolak) => nuqtasi + bolak)
    .join("\n");
}

/* pick(mijoz, "ism, telefon") -> { ism, telefon } — faqat kerakli maydonlar. */
function pick(obyekt, kalitlar) {
  const natija = {};
  if (!obyekt || typeof obyekt !== "object") return natija;
  for (const kaliti of toList(kalitlar)) {
    const nomi = String(kaliti).trim();
    if (!nomi || _XAVFLI.includes(nomi)) continue;
    const qiymati = get(obyekt, nomi, null);
    if (qiymati !== null) natija[nomi] = qiymati;
  }
  return natija;
}

/* Obyektning mazmuni emas, ichki tuzilishi. get() va pick() ularni bermaydi. */
const _XAVFLI = ["__proto__", "constructor", "prototype"];

// get(javob, "data.user.name") -> qiymat · get(javob, "yo'q.narsa") -> ""
// «HTTP so'rov» javobini o'qish uchun. Yo'lning o'rtasidagi bo'g'in bo'lmasa
// ham xato bermaydi: uchinchi argument (yoki bo'sh satr) qaytadi.
function get(manba, yol, zaxira) {
  const orqaga = zaxira === undefined ? "" : zaxira;
  if (manba === null || manba === undefined) return orqaga;
  if (yol === null || yol === undefined || yol === "") return manba;
  let joyi = manba;
  for (const bogin of String(yol).split(".")) {
    if (bogin === "") continue;
    if (joyi === null || joyi === undefined) return orqaga;
    if (typeof joyi !== "object" && typeof joyi !== "string") return orqaga;
    if (_XAVFLI.includes(bogin)) return orqaga;
    joyi = joyi[bogin];
  }
  return joyi === undefined || joyi === null ? orqaga : joyi;
}

// ─── Telegram ────────────────────────────────────────────────────────────────

// escapeHtml("<b>Ali</b> & Vali") -> "&lt;b&gt;Ali&lt;/b&gt; &amp; Vali"
// Bot xabarlari HTML rejimida ketadi (`sender.PARSE_MODE`), shuning uchun
// mijozning matnini xabarga qo'yishdan oldin shu kerak: ismidagi «<» butun
// xabarni Telegramga rad ettiradi. Uchta belgi — `engine/markdown.py` dagi
// ro'yxatning aynan o'zi.
function escapeHtml(qiymat) {
  return String(qiymat ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/*
 * MarkdownV2 da qochirilishi SHART bo'lgan o'n sakkiz belgi — Bot API
 * hujjatidan so'zma-so'z. Bittasi qolib ketsa Telegram butun xabarni «can't
 * parse entities» deb rad etadi, ya'ni mijoz umuman hech narsa olmaydi.
 */
const _MDV2 = "_*[]()~`>#+-=|{}.!";

/*
 * escapeMd("Narx: 12.500 (chegirma!)") -> "Narx: 12\.500 \(chegirma\!\)"
 *
 * Bot o'z xabarlarini HTML bilan yuboradi, shuning uchun oddiy blok uchun bu
 * kerak emas: u «HTTP so'rov» orqali `parse_mode: MarkdownV2` bilan xabar
 * yuborganingizda ishlaydi. Teskari chiziq birinchi bo'lib ikkilanadi — u
 * qochirish belgisining o'zi, va `sender.neutralise_markup` ham xuddi shu
 * sababdan uni ro'yxati boshiga qo'ygan.
 */
function escapeMd(qiymat) {
  let natija = String(qiymat ?? "").replace(/\\/g, "\\\\");
  for (const belgi of _MDV2) natija = natija.split(belgi).join("\\" + belgi);
  return natija;
}

// chunk(uzunMatn) -> ["…", "…"] — bitta xabar 4096 belgidan oshmaydi
// (`sender.FIELD_LIMITS`); oshsa Telegram uni rad etadi va mijoz hech narsa
// olmaydi. Bo'lish qator yoki so'z chegarasidan o'tadi; rasm izohi uchun
// chunk(matn, 1024).
function chunk(qiymat, uzunlik) {
  const chek = Math.max(1, Math.round(num(uzunlik, 4096)));
  const butun = String(qiymat ?? "");
  if (!butun) return [];
  if (butun.length <= chek) return [butun];

  const bolaklar = [];
  let qoldiq = butun;
  while (qoldiq.length > chek) {
    let kes = qoldiq.lastIndexOf("\n", chek);
    if (kes < chek / 2) kes = qoldiq.lastIndexOf(" ", chek);
    if (kes < chek / 2) kes = chek;
    bolaklar.push(qoldiq.slice(0, kes).replace(/\s+$/, ""));
    qoldiq = qoldiq.slice(kes).replace(/^\s+/, "");
  }
  if (qoldiq) bolaklar.push(qoldiq);
  return bolaklar;
}

// keyboard(["Ha", "Yo'q"]) -> Telegram `reply_markup` obyekti, sukut bo'yicha
// ikki ustun. «HTTP so'rov» orqali sendMessage ga berasiz; oqimning o'z
// tugmalari uchun kerak emas, ularni blokning o'zida yozasiz.
function keyboard(tugmalar, ustunlar) {
  const yorliqlar = toList(tugmalar).map((tugma) => _matn(tugma)).filter((yorliq) => yorliq !== "");
  const kenglik = Math.min(Math.max(Math.round(num(ustunlar, 2)), 1), 8);
  const qatorlar = [];
  for (let boshi = 0; boshi < yorliqlar.length; boshi += kenglik) {
    qatorlar.push(yorliqlar.slice(boshi, boshi + kenglik).map((yorliq) => ({ text: yorliq })));
  }
  return { keyboard: qatorlar, resize_keyboard: true, one_time_keyboard: true };
}

// ─── Mijoz javobini tushunish ────────────────────────────────────────────────

/* Solishtirish uchun kalit: kichik harf, apostrofsiz, tinish belgisisiz. */
function _kalit(qiymat) {
  return String(qiymat ?? "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/* Tahrir masofasi. Ikki qatorli jadval — xotira uzun javobda ham o'smasin. */
function _levenshtein(chap, ong) {
  if (chap === ong) return 0;
  if (!chap.length) return ong.length;
  if (!ong.length) return chap.length;
  let oldingi = Array.from({ length: ong.length + 1 }, (bosh, indeks) => indeks);
  for (let i = 1; i <= chap.length; i++) {
    const joriy = [i];
    for (let j = 1; j <= ong.length; j++) {
      const bahosi = chap[i - 1] === ong[j - 1] ? 0 : 1;
      joriy[j] = Math.min(joriy[j - 1] + 1, oldingi[j] + 1, oldingi[j - 1] + bahosi);
    }
    oldingi = joriy;
  }
  return oldingi[ong.length];
}

// similarity("terapefd", "Terapevt") -> 0.75 — 0 dan 1 gacha o'xshashlik; harf
// o'lchami va apostrof hisobga olinmaydi. Uzun matn 200 belgigacha qisqaradi,
// chunki hisob kvadratik.
function similarity(birinchi, ikkinchi) {
  const chap = _kalit(birinchi).slice(0, 200);
  const ong = _kalit(ikkinchi).slice(0, 200);
  if (!chap || !ong) return 0;
  if (chap === ong) return 1;
  return Math.round((1 - _levenshtein(chap, ong) / Math.max(chap.length, ong.length)) * 100) / 100;
}

/*
 * closest("terapefd", ["Terapevt", "Stomatolog"]) -> "Terapevt"
 *
 * Xato bilan yozilgan javobni ro'yxatdagi variantga bog'laydi — mijozga «qayta
 * yozing» demasdan. Hech biri yetarlicha o'xshamasa bo'sh satr qaytadi, ya'ni
 * «tushunmadim» yo'nalishini oqimning o'zida chizasiz. Uchinchi argument — eng
 * past o'xshashlik, sukut bo'yicha 0.6; uni ko'tarish noto'g'ri taxminni
 * kamaytiradi, tushirish esa ko'paytiradi.
 */
function closest(qiymat, royxat, chegara) {
  const eng = num(chegara, 0.6);
  const izlanayotgan = _kalit(qiymat);
  if (!izlanayotgan) return "";

  let yaxshisi = "";
  let ball = 0;
  for (const variant of toList(royxat)) {
    const yorliq = _matn(variant);
    if (!yorliq) continue;
    let bahosi = similarity(izlanayotgan, yorliq);
    // «terapevt» va «Terapevt (kattalar uchun)» — tahrir masofasi katta, ammo
    // mijoz aynan shuni yozgan. Uch harfdan uzun to'liq kirish shu sababdan
    // alohida hisoblanadi.
    const yorliqKaliti = _kalit(yorliq);
    if (izlanayotgan.length >= 3 && (yorliqKaliti.includes(izlanayotgan) || izlanayotgan.includes(yorliqKaliti))) {
      bahosi = Math.max(bahosi, 0.85);
    }
    if (bahosi > ball) {
      ball = bahosi;
      yaxshisi = yorliq;
    }
  }
  return ball >= eng ? yaxshisi : "";
}

const _HA = ["ha", "xa", "haa", "albatta", "roziman", "rozi", "mayli", "boladi", "togri", "yes", "ok", "okey", "hop", "xop", "1", "true", "da", "aga"];
const _YOQ = ["yoq", "yuq", "kerakmas", "kerak emas", "rad", "bekor", "istamayman", "no", "0", "false", "net"];

// yesNo("ha, albatta") -> true · yesNo("yo'q") -> false · yesNo("bilmadim") -> null
// Uch qiymatli: null — «tushunmadim», va bu ha ham, yo'q ham emas. Shuning uchun
// `=== true` deb tekshiring, shunchaki `if (yesNo(...))` emas. Uzun jumla
// birinchi so'zi bo'yicha ham qaraladi: «ha, roziman» — ha.
function yesNo(qiymat) {
  const xom = String(qiymat ?? "").trim();
  if (xom === "+" || xom === "👍" || xom === "✅") return true;
  if (xom === "-" || xom === "👎" || xom === "❌") return false;

  const kaliti = _kalit(qiymat);
  if (!kaliti) return null;
  if (_HA.includes(kaliti)) return true;
  if (_YOQ.includes(kaliti)) return false;

  const birinchi = kaliti.split(" ")[0];
  if (_HA.includes(birinchi)) return true;
  if (_YOQ.includes(birinchi)) return false;
  return null;
}

/* extractPhone("Raqamim +998 90 123-45-67, chaqiring") -> "998901234567" */
function extractPhone(qiymat) {
  const butun = String(qiymat ?? "");
  if (!butun) return "";
  for (const bolak of butun.match(/(?:\+?998)?[\s\-()]*\d[\d\s\-()]{7,}/g) || []) {
    const raqamlari = phone(bolak);
    if (raqamlari) return raqamlari;
  }
  return phone(butun.replace(/\D/g, ""));
}

// extractNumbers("2 dona, 12 000 so'm") -> [2, 12000] — gapdagi hamma sonlar,
// yozilish tartibida. Bo'shliq bilan yozilgan minglik bitta son bo'lib qoladi.
function extractNumbers(qiymat) {
  const butun = String(qiymat ?? "").replace(/ /g, " ");
  if (!butun) return [];
  return (butun.match(/-?\d+(?: \d{3})*(?:[.,]\d+)?/g) || []).map((bolak) => num(bolak));
}

const _NISBIY = {
  bugun: 0, "shu kun": 0,
  ertaga: 1, erta: 1,
  indinga: 2, indin: 2,
  kecha: -1, "kechagi kun": -1,
};

/*
 * parseDateUz("ertaga") · parseDateUz("27 avgust") · parseDateUz("dushanba")
 * parseDateUz("05.09") · parseDateUz("3 kundan keyin")  ->  "YYYY-MM-DD"
 *
 * Mijoz sanani qanday yozsa ham tushunadi. Tushunmasa bo'sh satr — «qayta
 * so'rang» yo'nalishini oqimda chizasiz.
 *
 * Ikkita qoida qabul qilingan, chunki bot sanani deyarli har doim OLDINDA
 * belgilaydi (uchrashuv, yetkazish, navbat): yili yozilmagan sana o'tib
 * ketgan bo'lsa keyingi yilga o'tadi, hafta kuni esa bugundan KEYINGI eng
 * yaqin o'sha kunni bildiradi — dushanba kuni «dushanba» degan mijoz keyingi
 * haftani nazarda tutadi.
 */
function parseDateUz(qiymat, asos) {
  const bugungi = _kunBoshi(toDate(asos) || _hozir());
  const xom = String(qiymat ?? "").trim();
  if (!xom) return "";
  const kaliti = _kalit(xom);
  if (!kaliti) return "";

  // 1. «bugun», «ertaga», «indinga»
  if (kaliti in _NISBIY) return _iso(_kunQosh(bugungi, _NISBIY[kaliti]));

  // 2. «3 kundan keyin», «2 haftadan keyin»
  let topildi = /^(\d{1,3})\s*(kun|hafta|oy)\S*\s*(keyin|so ng|sung)?$/.exec(kaliti);
  if (topildi) {
    const nechta = Number(topildi[1]);
    if (topildi[2] === "kun") return _iso(_kunQosh(bugungi, nechta));
    if (topildi[2] === "hafta") return _iso(_kunQosh(bugungi, nechta * 7));
    const oyli = new Date(bugungi.getTime());
    oyli.setMonth(oyli.getMonth() + nechta);
    return _iso(oyli);
  }

  // 3. Raqamli sana. Tinish belgilari _kalit dan o'tmagani uchun xom matndan.
  topildi = /^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/.exec(xom);
  if (topildi) {
    if (topildi[3] === undefined) return _yilsizSana(bugungi, Number(topildi[2]), Number(topildi[1]));
    let yili = Number(topildi[3]);
    if (yili < 100) yili += yili < 70 ? 2000 : 1900;
    const chiqdi = _sanaYasa(yili, Number(topildi[2]), Number(topildi[1]));
    return chiqdi ? _iso(chiqdi) : "";
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(xom)) {
    const chiqdi = toDate(xom);
    return chiqdi ? _iso(chiqdi) : "";
  }

  // 4. «27 avgust» va «avgust 27»
  topildi = /^(\d{1,2})\s+([a-z]+)/.exec(kaliti) || _teskariOy(kaliti);
  if (topildi) {
    const oyi = _oyRaqami(topildi[2]);
    if (oyi) return _yilsizSana(bugungi, oyi, Number(topildi[1]));
  }

  // 5. Hafta kuni. «shanba» boshqa kunlarning oxirida ham turgani uchun
  // solishtirish to'liq so'z bo'yicha ketadi, ichki qidiruv bilan emas.
  const sozlar = kaliti.split(" ");
  for (const soz of sozlar) {
    const kunRaqami = _HAFTA.indexOf(soz);
    if (kunRaqami === -1) continue;
    let farq = (kunRaqami - bugungi.getDay() + 7) % 7;
    if (farq === 0) farq = 7;
    if (sozlar.includes("keyingi") || sozlar.includes("kelasi")) farq += 7;
    return _iso(_kunQosh(bugungi, farq));
  }

  return "";
}

/* Yili aytilmagan sana: joriy yil, o'tib ketgan bo'lsa keyingi yil. */
function _yilsizSana(bugungi, oyi, kuni) {
  const joriy = _sanaYasa(bugungi.getFullYear(), oyi, kuni);
  if (!joriy) return "";
  if (joriy.getTime() >= bugungi.getTime()) return _iso(joriy);
  const keyingi = _sanaYasa(bugungi.getFullYear() + 1, oyi, kuni);
  return keyingi ? _iso(keyingi) : _iso(joriy);
}

/* «avgust 27» — raqam va oy o'rni almashgan holat. */
function _teskariOy(kaliti) {
  const topildi = /^([a-z]+)\s+(\d{1,2})/.exec(kaliti);
  return topildi ? [topildi[0], topildi[2], topildi[1]] : null;
}

/* Oy nomi -> 1..12. «sentyabr» va «sentabr» — ikkalasi ham. */
function _oyRaqami(nomi) {
  const past = nomi.replace(/y/g, "");
  for (let indeks = 0; indeks < _OYLAR.length; indeks++) {
    const oyi = _OYLAR[indeks].replace(/y/g, "");
    if (past === oyi || (past.length >= 3 && oyi.startsWith(past))) return indeks + 1;
  }
  return 0;
}

/*
 * parseTimeUz("15:30") -> "15:30" · parseTimeUz("kechqurun 7") -> "19:00"
 * parseTimeUz("ertalab 9") -> "09:00" · parseTimeUz("3 da") -> "03:00"
 *
 * Natija har doim "HH:MM", 24 soatlik. «kechqurun», «tushdan keyin», «kechasi»
 * soatni 12 ga suradi: mijoz «7 da kelaman» deganda kunduzgi yettini emas.
 */
function parseTimeUz(qiymat) {
  const past = String(qiymat ?? "").trim().toLowerCase();
  if (!past) return "";

  const kech = /(kechqurun|kechasi|kechga|kechki|tushdan keyin|peshindan keyin|kunduzi)/.test(past);
  const erta = /(ertalab|tongda|saharda|ertalabki)/.test(past);

  let soati;
  let daqiqasi = 0;
  let topildi = /(\d{1,2})\s*[:.\-]\s*(\d{2})/.exec(past);
  if (topildi) {
    soati = Number(topildi[1]);
    daqiqasi = Number(topildi[2]);
  } else {
    topildi = /(\d{1,2})/.exec(past);
    if (!topildi) return "";
    soati = Number(topildi[1]);
  }

  if (daqiqasi > 59) return "";
  if (kech && soati < 12) soati += 12;
  if (erta && soati === 12) soati = 0;
  if (soati > 23) return "";
  return _ikki(soati) + ":" + _ikki(daqiqasi);
}

// ─── Yordamchi ───────────────────────────────────────────────────────────────

// randomId() -> "K7QP2M9X" — buyurtma va navbat raqami uchun. Adashtiradigan
// harflar yo'q: 0/O va 1/I/l yozilmaydi, chunki mijoz bu kodni telefonda o'qib
// aytadi. Uzunligi 1 dan 64 gacha.
function randomId(uzunlik) {
  const alifbo = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chek = Math.min(Math.max(Math.round(num(uzunlik, 8)), 1), 64);
  let natija = "";
  for (let bosqich = 0; bosqich < chek; bosqich++) {
    natija += alifbo[Math.floor(Math.random() * alifbo.length)];
  }
  return natija;
}

// hash("998901234567") -> 0 dan 4294967295 gacha son; bir xil qiymat har doim
// bir xil son beradi. Mijozlarni guruhga bo'lish uchun: hash(inputs.telefon) % 2
// — yarmiga bitta xabar, yarmiga boshqasi, va hech kim guruhini almashtirmaydi.
function hash(qiymat) {
  const xom = typeof qiymat === "string" ? qiymat : safe(() => JSON.stringify(qiymat), "") || String(qiymat);
  let raqami = 2166136261;
  for (let indeks = 0; indeks < xom.length; indeks++) {
    raqami ^= xom.charCodeAt(indeks);
    raqami = Math.imul(raqami, 16777619);
  }
  return raqami >>> 0;
}

// safe(() => JSON.parse(inputs.javob), {}) -> qiymat yoki {}. Xato berishi
// mumkin bo'lgan kodni o'rab qo'yadi. Bu kutubxonaning funksiyalari allaqachon
// shunday — safe() esa siz yozadigan kod uchun.
function safe(amal, zaxira) {
  const orqaga = zaxira === undefined ? "" : zaxira;
  if (typeof amal !== "function") return amal === undefined || amal === null ? orqaga : amal;
  try {
    const natija = amal();
    return natija === undefined || natija === null ? orqaga : natija;
  } catch (xato) {
    return orqaga;
  }
}

/* Ro'yxatdagi elementni odam o'qiydigan matnga aylantiradi. */
function _matn(qiymat) {
  if (qiymat === null || qiymat === undefined) return "";
  if (typeof qiymat !== "object") return String(qiymat);
  for (const maydon of ["nom", "name", "title", "sarlavha", "matn", "text", "label"]) {
    if (qiymat[maydon] !== undefined && qiymat[maydon] !== null && String(qiymat[maydon]) !== "") {
      return String(qiymat[maydon]);
    }
  }
  return Object.keys(qiymat)
    .map((kaliti) => String(qiymat[kaliti] ?? ""))
    .filter((bolak) => bolak !== "")
    .join(" — ");
}
