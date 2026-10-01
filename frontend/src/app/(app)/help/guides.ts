import type { IconName } from "@/components/ui/Icon";

/**
 * The written guides behind the help centre.
 *
 * Content, not data: nothing here is per-tenant, so it lives beside the routes
 * that render it rather than behind a repository. Every step names a screen
 * this app actually has — a guide that walks somebody through a button that
 * does not exist is worse than no guide, because they stop trusting the rest.
 */
export interface GuideStep {
  title: string;
  body: string;
  /**
   * The literal text the step is about — a graph, a port table, a prompt.
   *
   * Prose cannot carry a JSON object: the reader has to copy it, and a
   * paragraph that spells out «nodes ro'yxati ichida id, type va text» is a
   * description of a thing rather than the thing. Rendered verbatim in a
   * monospace block, so whitespace is content here and every line is one the
   * reader may paste somewhere it has to parse.
   */
  code?: string;
  /** Where in the app the step happens, when it happens in one place. */
  href?: string;
  linkLabel?: string;
}

export interface Guide {
  slug: string;
  title: string;
  /** One line, shown on the card and under the title. */
  summary: string;
  icon: IconName;
  /** Honest reading time, in minutes. */
  minutes: number;
  steps: GuideStep[];
  /** What to know once it works — limits, traps, where to look when it does not. */
  notes?: string[];
}

export const GUIDES: Guide[] = [
  {
    slug: "botni-ulash",
    title: "Botni ulash",
    summary: "@BotFather'dan token olib, botni ish maydoniga qo'shish va webhookni tekshirish.",
    icon: "robot",
    minutes: 4,
    steps: [
      {
        title: "@BotFather'da bot yarating",
        body:
          "Telegramda @BotFather'ni oching va /newbot buyrug'ini yuboring. Botga ko'rinadigan nom va «bot» bilan " +
          "tugaydigan @username bering. BotFather javobida 123456789:AAH… ko'rinishidagi API token keladi — shu " +
          "token botingizning kaliti.",
      },
      {
        title: "Tokenni Oqim Studioga qo'ying",
        body:
          "Botlar bo'limida «Yangi bot qo'shish» tugmasini bosing. Ochilgan sahifada «Botni ulash» varag'iga " +
          "tokenni joylashtiring — boshqa hech narsa so'ralmaydi, bot nomi va @username tokendan Telegramning " +
          "o'zidan olinadi. Yonidagi «Botni yaratish» varag'i esa hali mavjud bo'lmagan botni @BotFather'siz, " +
          "shu yerdan yaratadi.",
        href: "/bots/new",
        linkLabel: "Yangi bot",
      },
      {
        title: "Webhook avtomatik ulanadi",
        body:
          "Token qabul qilingach, Telegram yangiliklarni platformaga yuborishi uchun webhook o'zi ro'yxatdan " +
          "o'tkaziladi. Holatni Bot → Sozlamalar bo'limining tepasidagi «Ulanish» qatori aytadi: «Hammasi " +
          "joyida» yoki «N ta muammo» — muammo bo'lsa qator o'zi ochilib turadi, ichida bot manzili va " +
          "tokeni. Webhook har o'n daqiqada o'zi qayta tekshiriladi, shuning uchun ko'p holda kutish kifoya.",
        href: "/bots",
        linkLabel: "Botlar ro'yxati",
      },
      {
        title: "Bo'limlarni oching",
        body:
          "Bot sahifasi o'zi «Bot ichida» bo'limini ochadi; yonida Business turadi. Guruh, Kanal va Web App " +
          "qatorda ko'rinadi-yu, hozircha «Tez orada» — ochilmaydi. «Bot ichida» bo'limi darhol «Asosiy oqim» " +
          "bilan keladi — /start birinchi kundan javobsiz qolmaydi.",
      },
      {
        title: "Telegramda tekshiring",
        body:
          "Botingizga /start yozing. Javob kelsa — ulanish tayyor, va o'sha odam Kontaktlar ro'yxatida paydo " +
          "bo'ladi. Javob kelmasa, avval webhook holatini ko'ring.",
        href: "/contacts",
        linkLabel: "Kontaktlar",
      },
    ],
    notes: [
      "Token — parol bilan barobar. Uni hech kimga bermang; sizib chiqqan bo'lsa @BotFather'da /revoke qiling, so'ng Bot → Sozlamalar → «Botni uzish» qilib yangi token bilan qaytadan ulang — oqimlar saqlanadi.",
      "Bitta bot bitta ish maydoniga ulanadi: bir tokenni ikki joyda ishlatsangiz, webhook oxirgi ulangan tomonga ketadi.",
    ],
  },
  {
    slug: "birinchi-oqim",
    title: "Birinchi oqim",
    summary: "Shablondan, yordamchidan yoki bo'sh kanvasdan boshlab, savol beradigan va javobni saqlaydigan oqim yig'ish.",
    icon: "flow-arrow",
    minutes: 6,
    steps: [
      {
        title: "Bo'limni tanlang",
        body:
          "Bot sahifasi → «Bot ichida». Oqim qaysi bo'limda tursa, o'sha yerdagi xabarlarga javob beradi: " +
          "Business oqimi bot ichidagi yozishmani, «Bot ichida» oqimi Business xabarini ko'rmaydi.",
        href: "/bots",
        linkLabel: "Botlar",
      },
      {
        title: "Uch yo'lning birini tanlang",
        body:
          "«Yangi oqim» tugmasi «Oqimni qanday boshlaymiz?» oynasini ochadi: «Tayyor shablondan» (eng tez), " +
          "«Yordamchi bilan yig'ish» (uch savol) va «Eng sodda oqim» (Handler va bitta xabar). Uchalasi ham kod " +
          "talab qilmaydi. Marketdagi shablonlar bu ro'yxatga kirmaydi — ular alohida turadi va «O'rnatish» " +
          "bosilganda oqim sifatida qo'shiladi.",
        href: "/market",
        linkLabel: "Market",
      },
      {
        title: "Bloklarni qo'ying",
        body:
          "Boshlanish bloki oqim bilan birga keladi — asosiy oqimda «/start», qolganlarida «Boshlanish sharti» " +
          "(Handler) — uni palitradan qo'shilmaydi, u allaqachon kanvasda turadi. Qolganini chapdagi «Bloklar» " +
          "ro'yxatidan olasiz; 1–9 tugmalari ham shu ro'yxat bo'ylab ishlaydi. Eng qisqa ishlaydigan zanjir: " +
          "Handler → «Xabar» (bot nima deydi) → «Savol» (javobni kutadi va o'zgaruvchiga yozadi) → " +
          "«Ma'lumotni saqlash» (kontaktga teg qo'yadi yoki qiymat saqlaydi).",
      },
      {
        title: "Chiqishlarni bog'lang",
        body:
          "Har bir blokning chiqish nuqtasini keyingi blokka torting. Bog'lanmagan chiqish — oqimning oxiri: " +
          "mijoz uchun bu «bot javob bermay qoldi» degani, shuning uchun tugma va shartlarning har bir yo'li " +
          "qayergadir borishi kerak.",
      },
      {
        title: "Sinov suhbatida yurgizing",
        body:
          "Yuqoridagi «Sinash» tugmasi oqimni sinov suhbatida yuradi: xuddi shu runtime, xuddi shu bloklar, " +
          "lekin haqiqiy mijoz ham, statistika ham tegilmaydi. Blok kartochkasidagi ▶ ham shu oynani ochadi, " +
          "faqat o'sha blokdan boshlab.",
      },
      {
        title: "Saqlang va ishga tushiring",
        body:
          "Oqim o'zi saqlanadi — tepadagi qator «Saqlandi · hozir» deb turadi. Saqlanmagan o'zgarish bo'lsa " +
          "yonida «Saqlash» tugmasi paydo bo'ladi (Ctrl/⌘+S ham shu ishni qiladi). Keyin «Ishga tushirish» " +
          "tugmasi oqimni jonli qiladi va u «Faol» bo'ladi. Bo'sh oqimni yoqib bo'lmaydi — avval kamida bitta " +
          "blok qo'ying.",
      },
      {
        title: "Yig'ilgan javoblarni ko'ring",
        body:
          "Savol bloklari saqlagan javoblar Kontaktlar ro'yxatida va kontakt kartasidagi «Oqim yiqqan ma'lumot» " +
          "bo'limida turadi. Ro'yxatdagi «Ustunlar» qatoridan o'zgaruvchini bosib, uni jadvalga ustun qilib " +
          "qo'shishingiz mumkin.",
        href: "/contacts",
        linkLabel: "Kontaktlar",
      },
    ],
    notes: [
      "Handler bloki oqimning yagona kirish nuqtasi: qolgan bloklarga faqat bog'lanish orqali kelinadi.",
      "Bir botda /start ga javob beradigan asosiy oqim bitta bo'ladi — ikkinchisini yaratish o'rniga mavjudini tahrirlang.",
    ],
  },
  // Third, straight after «Birinchi oqim», because it answers that guide's
  // question a second time for a flow too big to draw: same job, same reader,
  // one page later. Ahead of the feature guides below it — payments, operator,
  // fallback are things a flow grows, and this is still how a flow is built.
  {
    slug: "json-orqali-oqim",
    title: "JSON orqali oqim yuklash",
    summary: "Grafikni boshqa AI da yozdirib, «Kod» bo'limida tekshirib import qilish — va chiqish nomlarini to'g'ri yozish.",
    icon: "code",
    minutes: 9,
    steps: [
      {
        title: "Oqim — aslida ikkita ro'yxat",
        body:
          "Kanvasdagi kartochkalar va ular orasidagi chiziqlar oddiy JSON bo'lib saqlanadi: «nodes» — bloklar " +
          "ro'yxati, «edges» — bog'lanishlar ro'yxati. Uchinchi narsa yo'q. Ya'ni oqimni chizish shart emas — " +
          "shu ikki ro'yxatni matn qilib yozib, «Kod» bo'limiga qo'ysangiz, undan xuddi qo'lda yig'ilgandek " +
          "to'liq ishlaydigan oqim chiqadi. Qirq blokli oqim uchun bu bir necha soatlik farq.",
        code: `{
  "nodes": [ ... ],
  "edges": [ ... ]
}`,
      },
      {
        title: "Blok va bog'lanish shakli",
        body:
          "Blokda takrorlanmas «id», «type» (blok turi), «title» (kartochkaning nomi) va turiga qarab " +
          "qo'shimcha maydonlar bo'ladi; «x» bilan «y» — faqat kanvasdagi joyi, mazmunga ta'sir qilmaydi. " +
          "Bog'lanish esa bitta blokning aynan bitta chiqishini boshqa blokka ulaydi: «from» — qayerdan, " +
          "«port» — qaysi chiqishdan, «to» — qayerga. «port» majburiy: usiz yozilgan bog'lanishni runtime " +
          "hech qachon topmaydi, chunki u portni harfma-harf solishtiradi.",
        code: `{
  "id": "m1",
  "type": "message",
  "title": "Salom",
  "text": "Assalomu alaykum!",
  "x": 320,
  "y": 40
}

{ "id": "e1", "from": "m1", "port": "out", "to": "q1" }`,
      },
      {
        title: "Chiqish nomlari — xato ko'pincha shu yerda",
        body:
          "Boshqa AI eng ko'p shu joyda adashadi: «next», «default», «success» kabi nomlarni o'ylab topadi, " +
          "bunday chiqishlar esa yo'q. Import bunday bog'lanishni rad etadi — va bu yaxshi, chunki o'tib " +
          "ketganida bot o'sha blokda jim bo'lib qolardi, hech qayerda sababi ko'rinmasdan. Ro'yxat qisqa: " +
          "jami yigirma to'rtta blok turi bor va quyida sanalganidan tashqari o'n beshtasining hammasida " +
          "bitta «out» chiqishi bor.",
        code: `condition      yes, no
script         ok, error
subscription   subscribed, not_subscribed
agent.ask      answered, unclear, handoff
invoice        paid, cancelled   (+ tugmalar, + back)
end            chiqishi yo'q — oqim shu yerda tugaydi
message        out               (+ tugmalar, + back)
menu           out               (+ tugmalar, + back)
question       out               (+ tugmalar, + back)

qolgan 15 turi — faqat out:
start · trigger · groupjoin · groupleave · joinrequest
channelpost · rating · followup · language · delay
tag · ai · http · human · flowlink

tugmalar = har bir «callback» tugmasi uchun btn:<tugma id>
back     = blokda «Orqaga» qatori bo'lsa`,
      },
      {
        title: "Bitta oqim — bitta boshlanish bloki",
        body:
          "Oqimni nima ochishini boshlanish bloklari aytadi: «start», «trigger», «groupjoin», «groupleave», " +
          "«joinrequest», «channelpost». Bot ichidagi oqim uchun «start» yoki «trigger» ishlatiladi va " +
          "grafikda ular ikkitasi birga bo'lsa import rad etadi: muharrir keyin ortiqchasini bog'lanishlari " +
          "bilan o'chirib yuboradi, ya'ni qabul qilingani sizga blok yo'qotadigan oqim qaytargan bo'lardi. " +
          "Guruh va kanal hodisalari bunga kirmaydi — bitta guruh oqimi ham qo'shilishga, ham chiqib ketishga " +
          "javob bersa bo'ladi. Ikkinchi qoida: boshlanish blokiga bog'lanish kirmaydi, undan faqat chiqadi.",
      },
      {
        title: "To'liq namuna",
        body:
          "Beshta blok, to'rtta bog'lanish, ishlaydigan oqim: /start bosilganda shahar so'raladi, javob " +
          "«shahar» nomi bilan saqlanadi, so'ng shartga qarab ikki xil javob beriladi. Har bir «port» shu " +
          "yerda to'g'ri: savoldan «out», shartdan «yes» va «no». Shundoqligicha nusxalab qo'ysangiz, " +
          "tekshiruvdan xatosiz o'tadi — o'zingiznikini shu qolipdan boshlab yozing.",
        code: `{
  "nodes": [
    {
      "id": "t1",
      "type": "trigger",
      "title": "Boshlanish",
      "text": "/start",
      "dmsTrigger": { "kinds": ["start"] },
      "x": 40,
      "y": 60
    },
    {
      "id": "q1",
      "type": "question",
      "title": "Shahar",
      "text": "Assalomu alaykum! Qaysi shahardasiz?",
      "answerType": "text",
      "saveAnswerAs": "shahar",
      "x": 320,
      "y": 60
    },
    {
      "id": "c1",
      "type": "condition",
      "title": "Toshkentmi?",
      "text": "shahar = Toshkent",
      "condition": {
        "combinator": "AND",
        "rules": [
          {
            "id": "r1",
            "negate": false,
            "field": "variable",
            "variableName": "shahar",
            "operator": "equals",
            "value": "Toshkent"
          }
        ]
      },
      "x": 600,
      "y": 60
    },
    {
      "id": "m1",
      "type": "message",
      "title": "Toshkent",
      "text": "Toshkent bo'ylab yetkazib berish bepul.",
      "x": 880,
      "y": -20
    },
    {
      "id": "m2",
      "type": "message",
      "title": "Boshqa shahar",
      "text": "{{shahar}} ga pochta orqali yuboramiz.",
      "x": 880,
      "y": 160
    }
  ],
  "edges": [
    { "id": "e1", "from": "t1", "port": "out", "to": "q1" },
    { "id": "e2", "from": "q1", "port": "out", "to": "c1" },
    { "id": "e3", "from": "c1", "port": "yes", "to": "m1" },
    { "id": "e4", "from": "c1", "port": "no",  "to": "m2" }
  ]
}`,
      },
      {
        title: "Bot → «Kod» bo'limini oching",
        body:
          "Kerakli hamma narsa shu bir sahifada: Botlar → botni oching → «Kod». Ichidagi «JSON orqali oqim» " +
          "qismi uch bo'lakdan iborat — grafikni qo'yadigan maydon, tayyor oqimlarni namuna qilib yuklab " +
          "olish uchun «Eksport» ro'yxati, va «Bloklar lug'ati». Yuklash ham shu yerda bo'ladi. Bo'lim " +
          "muharrirlik huquqi bor a'zolarga ochiq: analitik uni ko'radi, lekin oqim yarata olmaydi.",
        href: "/bots",
        linkLabel: "Botlar",
      },
      {
        title: "Lug'atni nusxalab, boshqa AI ga bering",
        body:
          "«Bloklar lug'ati» ostidagi «Lug'atni nusxalash» tugmasi tayyor so'rovni buferga oladi: grafik " +
          "shakli, barcha blok turlari, ularning chiqish nomlari va maydonlari. Uni ChatGPT'ga, Claude'ga " +
          "yoki boshqa modelga birinchi bo'lib qo'ying — busiz u nomlarni o'ylab topadi va grafik " +
          "tekshiruvdan o'tmaydi. So'ng oddiy tilda botingiz nima qilishini yozing. Botingizda tayyor oqim " +
          "bo'lsa, «Eksport» ro'yxatidan uni yuklab olib, o'sha faylni ham namuna qilib qo'shing.",
        code: `[«Lug'atni nusxalash» bergan matn shu yerda]

Endi shu qoidalar bo'yicha oqim yoz:
- /start bosilganda salomlashsin
- ismini so'rasin, javobni «ism» ga saqlasin
- keyin ikki tugma chiqarsin: «Narxlar» va «Operator»
- «Narxlar» narxlar ro'yxatini yuborsin
- «Operator» suhbatni operatorga uzatsin
Javob faqat JSON bo'lsin, izohsiz.`,
      },
      {
        title: "Javobni qaytaring va «Tekshirish» bosing",
        body:
          "Modelning javobini «Kod» bo'limidagi maydonga qo'ying yoki .json faylni «Fayl tanlash» orqali " +
          "oling. Javob kod bloki ichida kelgan bo'lsa ham bo'ladi — o'ramasi o'zi olib tashlanadi, va " +
          "«Eksport» bergan to'liq fayl ham, yalang'och «nodes» + «edges» ham qabul qilinadi. «Tekshirish» " +
          "hech narsa yozmaydi: u faqat nechta blok va bog'lanish borligini, qaysi turdan nechtaligini va " +
          "nima noto'g'ri ekanini ko'rsatadi — istagancha bosaverasiz.",
      },
      {
        title: "Nima rad etiladi, nima faqat belgilanadi",
        body:
          "Ikki xil topilma bor. Xato importni to'xtatadi, chunki uning oqibati — jim qolgan bot va hech " +
          "qayerda ko'rinmaydigan sabab. Ogohlantirish esa to'xtatmaydi: yarim yig'ilgan oqim ham yuklanadi " +
          "va qolganini kanvasda tugatasiz. Har bir satr qaysi blok haqida ekanini «id» bilan aytadi, " +
          "shuning uchun faylda o'sha id'ni qidirish kifoya.",
        code: `RAD ETADI
  noma'lum tur           "type": "kod" — bunday blok yo'q
  bo'lmagan chiqish      "port": "success" — Kod'da ok/error
  «port» yozilmagan      bog'lanishda port kaliti yo'q
  ikkita boshlanish      start va trigger bitta grafikda
  takrorlangan id        ikki blokda bir xil "id"
  yo'q blokka bog'lanish "to": "m9", m9 esa yo'q
  boshlanishga kiruvchi bog'lanish

FAQAT OGOHLANTIRADI
  ulanmagan chiqish      condition'ning "no" si bo'sh
  bo'sh matn             message'da "text" yo'q
  erishib bo'lmaydigan blok
  boshlanish bloki umuman yo'q`,
      },
      {
        title: "Import har doim yangi oqim yaratadi",
        body:
          "«Yangi oqim yaratish» tugmasi har safar yangi oqim ochadi va mavjudlariga tegmaydi — bu yerdan " +
          "ishlab turgan oqimni fayl bilan almashtirib bo'lmaydi. Yaratilgach muharrirga o'tasiz. Oqim " +
          "o'chirilgan holda keladi: «Ishga tushirish» bosilmaguncha mijozlarga javob bermaydi, shuning " +
          "uchun avval sinov suhbatida yurgizib ko'ring.",
      },
    ],
    notes: [
      "«x» va «y» bo'lmasa ham import o'tadi, lekin bloklar kanvasda bir joyga to'planadi — pastdagi «Tartiblash» tugmasi ularni ustunlarga yoyadi.",
      "Bir martada 512 KB gacha matn yuklanadi. Kattaroq grafikni ikki oqimga bo'ling va ularni «Oqimlar» bloki orqali ulang.",
      "Import qilingan grafik saqlanganda ham xuddi shu tekshiruvdan o'tadi: muharrirda qo'lda yozilgan noto'g'ri port ham saqlanmaydi.",
    ],
  },
  {
    slug: "tolovni-yoqish",
    title: "To'lovni yoqish",
    summary: "To'lov tizimini ulash, Invoys blokini qo'yish va tokensiz Telegram Stars varianti.",
    icon: "credit-card",
    minutes: 5,
    steps: [
      {
        title: "To'lov usulini tanlang",
        body:
          "Bot → To'lovlar. Ro'yxatda tayyor holda faqat Telegram Stars turadi — u token so'ramaydi va bot " +
          "tokeningiz orqali ishlaydi. Qolgan har qanday to'lov tizimini («Click», «Payme», «Uzum», «Stripe» " +
          "va @BotFather taklif qiladigan boshqalari) «To'lov tizimi qo'shish» orqali o'zingiz qo'shasiz. " +
          "Bir botda nechta merchant hisobingiz bo'lsa, shuncha tizim yonma-yon tursa bo'ladi.",
        href: "/bots",
        linkLabel: "Botlar",
      },
      {
        title: "Merchant tokenini oling",
        body:
          "Token to'lov tizimining o'zidan emas, @BotFather orqali beriladi: /mybots → botingiz → Payments → " +
          "kerakli tizim. Bu provider token, bot tokeni emas. Login yoki parol hech qachon so'ralmaydi. TEST " +
          "tokeni bilan oqimni to'liq sinab ko'rish mumkin — pul yechilmaydi.",
      },
      {
        title: "Tokenni ulang",
        body:
          "«To'lov tizimi qo'shish» ni bosing: «Nomi» ga tizim nomini yozing (masalan «Click»), «Provider " +
          "token» ga tokenni qo'ying va «Ulash» ni bosing. Token serverda qoladi — ekranda faqat maskalangan " +
          "ko'rinishi va TEST/LIVE rejimi turadi. Telegram Stars uchun esa qatorni ochib «Yoqish» ni bosish " +
          "kifoya. To'lov tizimlarini faqat ish maydoni egasi va adminlar ulaydi.",
      },
      {
        title: "Oqimga «Invoys / To'lov» blokini qo'ying",
        body:
          "Blok mahsulot nomi, tavsifi, narxi va valyutasidan invoys yig'adi va uni Telegramning to'lov oynasi " +
          "sifatida yuboradi. Blokning chiqishlari ajratilgan: to'landi va bekor qilindi — ikkalasiga ham javob " +
          "yozing. Birinchi to'lovdan keyin xuddi shu «Bot → To'lovlar» sahifasida, provayderlar ro'yxati " +
          "ostida «To'lovlar tarixi» bo'limi to'ladi: har bir qatorda to'lovchi, sana va summa turadi, eng " +
          "yangisi tepada. Bo'sh bo'lsa u «Hali to'lov yo'q» deb turadi — ya'ni bo'lim bor, unga tushadigan " +
          "to'lov yo'q.",
      },
      {
        title: "Tez yo'l: Telegram Stars (XTR)",
        body:
          "Yangi Invoys bloki XTR valyutasi bilan keladi. Stars bot tokeningiz orqali ishlaydi, ya'ni merchant " +
          "akkaunt va provayder tokeni umuman kerak emas — to'lov oqimini bugun sinab ko'rmoqchi bo'lsangiz, " +
          "shundan boshlang.",
      },
    ],
    notes: [
      "Narx eng kichik birlikda yuboriladi (so'm uchun tiyin, dollar uchun sent) — blok buni o'zi hisoblaydi, lekin summani sinov to'lovida bir marta tekshirib ko'ring.",
      "Provayder ulanmagan bo'lsa, XTR bo'lmagan Invoys bloki to'lov oynasini ocholmaydi.",
      // What the section shows and what it does not, both said: an owner who
      // opens it looking for an order number or a receipt is looking for
      // something nothing stores yet, and finding that out by scanning the
      // rows is worse than being told.
      "«To'lovlar tarixi» faqat Telegram tasdiqlagan to'lovlarni, oxirgi 50 tasini ko'rsatadi. Mahsulot nomi, qaysi provayder olgani va Telegram cheki raqami unda yo'q. Kontakti o'chirilgan to'lov «Noma'lum mijoz» bo'lib qoladi — pul o'z joyida, faqat kimligi yozilmagan.",
    ],
  },
  {
    slug: "operatorga-ulash",
    title: "Operatorga ulash",
    summary: "«Operatorga» bloki, navbat nomi va suhbat jonli odamga o'tganda nima bo'lishi.",
    icon: "headset",
    minutes: 4,
    steps: [
      {
        title: "«Operatorga» blokini qo'ying",
        body:
          "Palitradagi Operatorga bloki suhbatni odamga uzatadi. Uni odatda «bilmadim» tarmog'iga yoki murakkab " +
          "savol shartidan keyin qo'yishadi.",
      },
      {
        title: "Navbat nomini yozing",
        body:
          "Blok matni — navbat nomi, masalan «Navbat: Sotuv» yoki «Navbat: Texnik yordam». Bu bildirishnomada " +
          "ko'rinadi va kim javob berishini ajratadi.",
      },
      {
        title: "Blok ishga tushganda nima bo'ladi",
        body:
          "Suhbat «Operatorda» holatiga o'tadi va bot o'sha suhbatni davom ettirmaydi — mijozga bir vaqtda ikki " +
          "tomondan yozilmaydi. Ish maydoniga «Operator kerak» bildirishnomasi keladi.",
      },
      {
        title: "Qayerdan ko'rasiz",
        body:
          "Yuqoridagi qo'ng'iroqchada — bildirishnoma, Kontaktlar → kontakt kartasi → Suhbatlar bo'limida esa " +
          "o'sha suhbat «Operatorda» belgisi bilan turadi. Analitikadagi «Operatorga o'tdi» ko'rsatkichi " +
          "nechtasi shu yo'l bilan tugaganini sanaydi.",
        href: "/contacts",
        linkLabel: "Kontaktlar",
      },
      {
        title: "Operator javob bergandan keyin",
        body:
          "Mijoz keyingi safar yozganida oddiy tartib tiklanadi: xabarni mos handler ushlaydi. Hech qaysi oqim " +
          "ushlamasa bot jim qoladi va xabar «Suhbatlar»ga tushadi — buni «Har qanday xabar» handleri bilan " +
          "qoplash mumkin.",
        href: "/help/bot-jim-qolmasin",
        linkLabel: "Bot jim qolganda",
      },
    ],
    notes: [
      "AI bloki ham operatorga uzata oladi: uning «Javob topilmasa» sozlamasida «Operatorga uzatish» ni tanlang yoki «Model ishonchsiz javob bersa ham operatorga uzatilsin» ni yoqing.",
      "Ish vaqti tugagan payt uchun alohida tarmoq qo'ying — operator yo'q vaqtda «Operatorga» bloki mijozni kutib qoldiradi.",
    ],
  },
  // Sixth, under the guides about what a flow grows into and above the one that
  // gets opened first. It is the only guide here that asks the reader to write
  // code and the fewest of them ever will, so it sits below «To'lovni yoqish»
  // and «Operatorga ulash» — the same shape of question, asked by many more
  // people. It is not beside «JSON orqali oqim yuklash» either, though both are
  // about text rather than cards: that one is still how a flow is built, and
  // this is a thing a finished flow grows.
  {
    slug: "oqim-skripti",
    title: "Oqim skripti",
    summary: "Oqimning o'z JavaScript fayli: uchta hook, ular yozadigan o'zgaruvchilar va bularning narxi.",
    icon: "lightning",
    minutes: 7,
    steps: [
      {
        title: "Bloklar gapiradi, skript hisoblaydi",
        body:
          "Oqimni bloklar yuritadi: xabar yuboradi, savol beradi, shartga qarab tarmoqlanadi. Skript ularning " +
          "o'rniga emas, ular atrofida ishlaydi — runtime uni uchta aniq daqiqada chaqiradi, qaytgan qiymatni " +
          "esa oqim o'zgaruvchilariga yozadi. Ya'ni skriptning vazifasi gapirish emas, bloklar aytadigan gapga " +
          "qiymat tayyorlash: chegirmani hisoblash, ismni tozalash, javobni bitta belgi bilan nomlash. " +
          "JavaScript'da yoziladi.",
      },
      {
        title: "Ikkita fayl bor va ular ikki xil narsa",
        body:
          "«Oqim skripti» — shu oqimniki, faqat shu suhbat nima qilishini biladi. «Bot kutubxonasi» — botniki: " +
          "undagi funksiyalarni shu botning har bir oqimi, har bir «Kod» bloki va har bir ifoda chaqiradi. " +
          "Ish paytida kutubxona oqim skriptining tepasiga qo'yiladi, shuning uchun hook ichida kutubxona " +
          "funksiyasini nomi bilan chaqirsangiz bo'ladi. Kutubxonani Bot → «Kod» bo'limida tahrirlaysiz.",
        href: "/bots",
        linkLabel: "Botlar",
      },
      {
        title: "Panel muharrirning yuqorisida",
        body:
          "Oqimni oching va yuqoridagi qatorda «Sinash» yonidagi «Script» tugmasini bosing — panel kanvasni " +
          "yopib ochiladi. Tepasida ikki varaq: «Oqim skripti» va «Bot kutubxonasi». O'ng ustundagi «Hooklar» " +
          "ro'yxati uch nomni ko'rsatadi va bosilganda kursor turgan joyga bo'sh funksiya qo'yadi — nomni " +
          "qo'lda yozmagan ma'qul, chunki runtime uni harfma-harf qidiradi. Kod o'zi saqlanmaydi: «Saqlash» " +
          "tugmasi bor.",
      },
      {
        title: "Uchta hook, boshqasi yo'q",
        body:
          "Runtime shu uch nomni chaqiradi va boshqa hech qanday nomni izlamaydi. Funksiyani boshqacha " +
          "atasangiz, fayl bemalol saqlanadi-yu, hech qachon ishlamaydi — «Hooklar» ro'yxatidagi «faylda bor» " +
          "belgisi buni tekshirishning eng tez yo'li. onUserMessage har bir javobga bir marta ishlaydi: " +
          "yozilgan matn ham, bosilgan tugma ham javob. onFlowEnd esa oqim qanday tugasa ham ishlaydi — " +
          "oxirigacha yetganda ham, xato bilan to'xtaganda ham, mijoz yangi buyruq yozib eski suhbatni tashlab " +
          "ketganda ham.",
        code: `onFlowStart     oqim boshlanganda — birinchi blokdan oldin
onUserMessage   mijoz javob yozganda — javob blokka yetkazilishidan oldin
onFlowEnd       oqim tugaganda — oxirgi blokdan keyin`,
      },
      {
        title: "Hook nima oladi: ctx",
        body:
          "Uchala hook ham bitta argument oladi — ctx, ya'ni suhbat hozir qayerda turganini bildiruvchi obyekt. " +
          "Maydon nomlari camelCase'da: ctx.user.firstName, ctx.first_name emas. ctx.vars esa oqim yiqqan " +
          "o'zgaruvchilar — {{...}} ichida yozadigan nomlari bilan, o'zgarmagan holda. Kontakti yo'q suhbatda " +
          "ctx.user umuman bo'lmaydi, shuning uchun uni o'qishdan oldin tekshiring.",
        code: `ctx.module    qaysi bo'lim: dms («Bot ichida»), business, groups, channels
ctx.mode      "live" — haqiqiy mijoz, "test" — sinov suhbati
ctx.bot       id, username, name
ctx.flow      id, name
ctx.user      id, firstName, lastName, username, phone
ctx.chat      id, type, title
ctx.now       serverning hozirgi vaqti, ISO satr
ctx.locale    suhbat tili
ctx.vars      oqim o'zgaruvchilari: ctx.vars.narx
ctx.block     yonidagi blok — onFlowEnd'da bo'lmaydi
ctx.message   text va command — faqat onUserMessage'da`,
      },
      {
        title: "Qaytgan obyekt — oqim o'zgaruvchilari",
        body:
          "Hook obyekt qaytarsa, uning kalitlari oqim o'zgaruvchilariga xuddi «Ma'lumotni saqlash» bloki " +
          "yozgandek qo'shiladi: keyingi bloklar ularni {{...}} bilan o'qiydi, shartlar esa o'zgaruvchi " +
          "sifatida ko'radi. Obyektdan boshqa narsa qaytsa — son, satr, ro'yxat — hech nima yozilmaydi va bu " +
          "xato hisoblanmaydi. Kalit nomi harf yoki _ bilan boshlanishi kerak: «mijoz ismi» kabi nomni {{...}} " +
          "qayta o'qiy olmaydi, shuning uchun u jimgina tashlab yuboriladi. Bitta hook ko'pi bilan 40 ta kalit " +
          "yozadi. onFlowEnd qaytargan qiymat esa hech bir blokka yetib bormaydi — u ishlaganda oqim allaqachon " +
          "tugagan bo'ladi.",
        code: `function onFlowStart(ctx) {
  return {
    mijoz: ctx.user ? ctx.user.firstName : "mehmon",
    telefon_bor: Boolean(ctx.user && ctx.user.phone),
  };
}

Endi birinchi xabar «Salom, {{mijoz}}!» deb yozadi.`,
      },
      {
        title: "Sinang, keyin saqlang",
        body:
          "Kod maydonining ostidagi panel hookni saqlamasdan bir marta chaqiradi: «Qaysi hook» dan kerakligini " +
          "tanlaysiz, «Namuna ctx» maydonidagi tayyor obyektni o'z mijozingizga o'xshatib to'ldirasiz va " +
          "«Ishga tushirish» ni bosasiz. Javobda qaytgan qiymatdan tashqari «Oqimga shu o'zgaruvchilar " +
          "yoziladi» qatori ham bo'ladi — tashlab yuborilgan kalitlar aynan shu yerda ko'rinadi. Sinov " +
          "kutubxona bilan birga yuradi, ya'ni ish paytidagi bilan bir xil. «Saqlash» esa faylni avval " +
          "kompilyatsiya qilib ko'radi: sintaksisda xato bo'lsa saqlash rad etiladi va eski fayl joyida " +
          "qoladi, yozganingiz maydonda turaveradi.",
      },
      {
        title: "Xato hook suhbatni to'xtatmaydi",
        body:
          "Hook ichida xato chiqsa, oqim shundan keyin ham davom etadi: mijoz kutgan xabarini oladi, faqat " +
          "hook yozishi kerak bo'lgan o'zgaruvchilar yozilmay qoladi. Xato o'rniga izda bitta kulrang qator " +
          "qoladi — qaysi hook va qanday xato ekani yozilgan holda — va uni «Sinash» oynasida ko'rasiz. " +
          "Shunday qilingani ataylab: chatda kutib turgan odam skriptni tuzata oladigan odam emas. Lekin " +
          "buning narxi ham bor — buzuq hook o'zi haqida gapirmaydi, shuning uchun yangi hook yozganingizdan " +
          "keyin oqimni bir marta sinab ko'ring.",
      },
      {
        title: "Nimaga tushadi",
        body:
          "Har bir chaqiruv alohida jarayon: uni ishga tushirishning o'ziga 100 ms ga yaqin vaqt ketadi, " +
          "kodning o'ziga esa 2 soniya beriladi — undan oshsa to'xtatiladi. Bitta Telegram yangiligiga uchala " +
          "hook ham ko'pi bilan bir martadan ishlaydi, ya'ni eng yomon holatda uchta jarayon. Skripti yo'q " +
          "oqim esa hech narsaga tushmaydi: runtime birinchi qatordayoq chiqib ketadi va hech nima " +
          "boshlanmaydi. Har bir blok uchun alohida hook shuning uchun yo'q — besh blokli oqim Telegram " +
          "beradigan bir necha soniya ichida beshta jarayon ochishi kerak bo'lardi.",
      },
    ],
    notes: [
      "Skript oqimning o'zida turadi, lekin «Nusxa olish» ham, «Eksport» ham uni olib ketmaydi: nusxada va yuklab olingan faylda faqat grafik bo'ladi. Kodni qo'lda ko'chirasiz.",
      "Skript ichidan nimaga yetib bo'ladi va nimaga bo'lmaydi — tarmoq, fayl, import, xotira — Bot → «Kod» bo'limidagi «Qanday yoziladi» panelida sanab chiqilgan. Chegaralar oqim skripti uchun ham, kutubxona uchun ham bitta.",
      "Bir faylda bitta nomni ikki marta e'lon qilmang: JavaScript ikkinchisini oladi va siz birinchisini tahrirlab o'tiraverasiz.",
      "Fayl 40 000 belgigacha. Kodni saqlash va ishga tushirish uchun tahrirlash huquqi kerak — analitik faylni o'qiy oladi, xolos.",
    ],
  },
  // Last, and it is the guide that gets opened first — "botim javob bermayapti"
  // is the most asked question there is. It used to walk the reader through a
  // «Javob topilmaganda» panel on the bot's Sozlamalar screen, six steps of it,
  // and that panel is gone along with the runtime under it: nothing sends an
  // apology any more, and an unclaimed message is filed to Suhbatlar instead.
  // Six steps to a button that does not exist is worse than no guide, because
  // the reader who cannot find it concludes the fault is theirs. So the answer
  // it gives now is the one the product actually has — a flow whose Handler
  // catches everything nobody else claimed.
  {
    slug: "bot-jim-qolmasin",
    title: "Bot jim qolganda",
    summary: "Javobsiz qolgan xabar qayerga tushadi va uni ushlaydigan zaxira oqimni qanday yig'ish.",
    icon: "chat-dots",
    minutes: 5,
    steps: [
      {
        title: "Bot nega jim qoladi",
        body:
          "Bot faqat oqimlar orqali gapiradi. Har bir oqimning boshida boshlanish bloki turadi va u shu oqim " +
          "qanday xabarga javob berishini aytadi. Kelgan xabarni hech bir oqim ushlamasa, bot hech nima " +
          "yubormaydi — na javob, na xato. Bu buzilish emas, shunday tuzilgan: bot o'z oqimlari qoplagan " +
          "narsani aytadi va boshqa hech nima demaydi.",
      },
      {
        title: "Javobsiz xabar yo'qolmaydi",
        body:
          "Hech kim ushlamagan xabar ham yozib olinadi va «Suhbatlar» ro'yxatiga tushadi. Suhbatni ochsangiz, " +
          "pastdagi «Xabar yozing…» qatoridan unga o'zingiz javob bera olasiz. Zaxira oqim qurishdan oldin shu " +
          "ro'yxatni bir varaqlab chiqing: mijozlar aslida nima yozayotgani zaxira javobda nima turishi " +
          "kerakligini aytadi.",
        href: "/chats",
        linkLabel: "Suhbatlar",
      },
      {
        title: "Zaxira oqimni boshlang",
        body:
          "Bot sahifasi → «Bot ichida» → «Yangi oqim». Ochilgan «Oqimni qanday boshlaymiz?» oynasidan " +
          "«Yordamchi bilan yig'ish» ni tanlang: uch savol, kanvasga tegmasdan, telefonda ham ishlaydi.",
        href: "/bots",
        linkLabel: "Botlar",
      },
      {
        title: "Birinchi savol: «Har qanday xabar»",
        body:
          "«Oqim qachon ishga tushsin?» ro'yxatidan «Har qanday xabar» ni tanlang — kartochkaning o'zi buni " +
          "«hech bir boshqa oqim javob bermagan xabarlar uchun zaxira» deb aytadi. To'ldiradigan maydon yo'q, " +
          "darhol keyingi qadamga o'tasiz.",
      },
      {
        title: "Ikkinchi savol: bot nima qilsin",
        body:
          "«Bot nima qilsin?» — eng ishonchli juftlik «Avtomatik javob» va undan keyin «Operatorga uzatish». " +
          "Birinchisiga qisqa matn yozing («Bu savolni bot tushunmadi — hozir odam qaraydi»), ikkinchisida " +
          "navbatni tanlang. Ikkalasi ham zanjirga ketma-ket qo'shiladi va yaratilishi bilan ishlaydi.",
      },
      {
        title: "Uchinchi qadam: yarating va sinang",
        body:
          "«Tekshirish» qadamida oqimga nom bering — masalan «Zaxira javob» — va «Yaratish va yoqish» ni " +
          "bosing: oqim darhol faol bo'ladi. Ochilgan muharrirdagi «Sinash» tugmasi uni sinov suhbatida " +
          "yurgizadi; so'ng Telegramda botga hech qaysi oqim kutmaydigan tasodifiy gap yozib ko'ring.",
      },
      {
        title: "Zaxira boshqa oqimlarni bosib qolmaydi",
        body:
          "«Har qanday xabar» handleri eng oxirida tekshiriladi: /start, buyruq va kalit so'z oqimlari undan " +
          "avval yuradi, ya'ni zaxiraga faqat hech kim olmagan xabar qoladi. Buni Handler blokini ochib, " +
          "«Qo'shimcha sozlamalar» → «Ustuvorlik» dan ko'rsangiz bo'ladi: daraja «Zaxira (catch-all)» deb " +
          "turadi va uni qo'lda o'zgartirish shart emas.",
      },
    ],
    notes: [
      "Tugmali menyu qo'shmoqchi bo'lsangiz, uni yordamchida emas, muharrirda tugating: yordamchi tugmani chizadi, lekin uni hech qayerga ulamaydi — ulanmagan tugma bosilganda hech nima bo'lmaydi.",
      "Zaxira handler odam yozgan xabar va media uchun ishlaydi. Tugma bosilishi, reaksiya, guruhga qo'shilish kabi hodisalar unga tushmaydi — ularning har biri o'z shartini talab qiladi.",
      "Bitta bo'limda ikkita zaxira oqim bo'lsa, faqat oldinroq yaratilgani javob beradi; ikkinchisi hech qachon ishlamaydi. Bittasini o'chirib qo'ying.",
      "Zaxira oqim majburiy emas. Qurmasangiz bot shunchaki jim qoladi va xabar «Suhbatlar»da operatorni kutib turadi — kichik jamoa uchun bu ham to'g'ri tanlov.",
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}
