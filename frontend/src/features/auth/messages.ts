/**
 * Every string the auth screens render, in one place.
 *
 * Centralised rather than inlined so translating the product is swapping this
 * object (or keying it by locale) instead of hunting through seven pages — and
 * so the wording of an error can be fixed once. Tone rule: buttons are verbs,
 * errors say what to do next and never blame the reader.
 *
 * The `subtitle` of every screen is gone, along with the per-field hints. Each
 * one restated its own title in a sentence — "Kirish" over "Ish maydoningizga
 * kiring va oqimlarni davom ettiring." — and together they were most of the
 * small grey text on the only screens a signed-out visitor ever sees. What is
 * left is a title, labels, example placeholders, and one (i) per screen for
 * the single rule that is not guessable.
 */
export const AUTH_COPY = {
  brand: {
    name: "Oqim",
    suffix: "Studio",
  },

  common: {
    email: "Email",
    emailPlaceholder: "siz@kompaniya.uz",
    password: "Parol",
    passwordShow: "Parolni ko'rsatish",
    passwordHide: "Parolni yashirish",
    capsLock: "Caps Lock yoqilgan.",
    submitting: "Yuborilmoqda…",
    loading: "Yuklanmoqda…",
    or: "yoki",
  },

  login: {
    title: "Kirish",
    passwordLabel: "Parol",
    remember: "Meni eslab qol",
    forgot: "Parolni unutdingizmi?",
    submit: "Kirish",
    noAccount: "Hisobingiz yo'qmi?",
    signupLink: "Ro'yxatdan o'tish",
    expired: "Sessiya muddati tugadi. Qaytadan kiring.",
    loggedOut: "Hisobdan chiqdingiz.",
    verifiedFirst: "Avval emailingizni tasdiqlang.",
    signInFirst: "Bu sahifa uchun avval kirish kerak.",
  },

  signup: {
    title: "Hisob yaratish",
    name: "Ism va familiya",
    namePlaceholder: "Aziza Sultonova",
    /** The one (i) on this screen: a rule the reader cannot guess from the label. */
    passwordRule: "Kamida 8 belgi, harf va raqam aralash.",
    confirm: "Parolni tasdiqlash",
    terms: "Foydalanish shartlariga roziman",
    termsLink: "Shartlar",
    submit: "Hisob yaratish",
    haveAccount: "Hisobingiz bormi?",
    loginLink: "Kirish",
  },

  forgot: {
    title: "Parolni tiklash",
    submit: "Havola yuborish",
    successTitle: "Havola yuborildi",
    /* Deliberately says "if this address is registered": naming a missing
       account here hands an attacker a list of valid emails. */
    successBody: "Agar bu manzil ro'yxatdan o'tgan bo'lsa, tiklash havolasi yuborildi.",
    resend: "Qayta yuborish",
    backToLogin: "Kirishga qaytish",
  },

  reset: {
    title: "Yangi parol",
    newPassword: "Yangi parol",
    confirm: "Yangi parolni tasdiqlash",
    submit: "Parolni saqlash",
    successTitle: "Parol yangilandi",
    successBody: "Endi yangi parolingiz bilan kirishingiz mumkin.",
    goToLogin: "Kirishga o'tish",
    invalidTitle: "Havola yaroqsiz",
    invalidBody: "Bu havola noto'g'ri yoki allaqachon ishlatilgan.",
    expiredTitle: "Havola muddati tugagan",
    expiredBody: "Tiklash havolasi 60 daqiqa amal qiladi.",
    requestNew: "Yangi havola so'rash",
    checking: "Tekshirilmoqda…",
  },

  verify: {
    title: "Emailingizni tekshiring",
    sentTo: "Email",
    resend: "Havolani qayta yuborish",
    resendIn: (seconds: number) => `Qayta yuborish · ${seconds} s`,
    resent: "Havola qayta yuborildi.",
    wrongEmail: "Email noto'g'rimi?",
    changeEmail: "Boshqa email",
    otherAccount: "Boshqa hisob",
    codeLabel: "Tasdiqlash kodi",
    /** The one (i) on this screen: why there is a field when there is a link. */
    codeInfo: "Xatdagi havolani ochsangiz kod o'zi to'ldiriladi.",
    /** Development only — the backend hands the code over when there is no inbox. */
    devMode: "Test rejimi · pochta yuborilmadi",
    verifiedTitle: "Email tasdiqlandi",
    verifiedBody: "Endi ish maydonini tanlashingiz mumkin.",
    continue: "Davom etish",
  },

  workspace: {
    title: "Ish maydoni",
    joinTab: "Qo'shilish",
    createTab: "Yaratish",
    code: "Taklif kodi",
    codePlaceholder: "Havola yoki kod",
    join: "Qo'shilish",
    name: "Nomi",
    namePlaceholder: "Kompaniya nomi",
    locale: "Til",
    create: "Yaratish va boshlash",
    /** Reached from the switcher rather than owed as a step — see `addTitle`. */
    addTitle: "Yangi ish maydoni",
    cancel: "Bekor qilish",
  },

  errors: {
    required: "Bu maydon to'ldirilishi shart.",
    emailFormat: "Email manzili noto'g'ri — masalan: ism@kompaniya.uz",
    passwordShort: "Parol kamida 8 belgidan iborat bo'lsin.",
    passwordWeak: "Parol juda oddiy — harf va raqam aralashtiring.",
    passwordMismatch: "Parollar mos kelmadi.",
    nameShort: "Ism kamida 2 belgidan iborat bo'lsin.",
    termsRequired: "Davom etish uchun shartlarga rozilik kerak.",
    codeFormat: "Kod 16 ta belgidan iborat. Sizga yuborilgan havolani to'liq qo'ysangiz ham bo'ladi.",
    workspaceName: "Ish maydoni nomi kamida 2 belgi bo'lsin.",
  },

  strength: {
    levels: ["Juda zaif", "Zaif", "O'rtacha", "Yaxshi", "Kuchli"],
    tips: {
      length: "8 belgidan uzun qiling",
      number: "raqam qo'shing",
      letter: "harf qo'shing",
      case: "katta harf qo'shing",
      symbol: "belgi qo'shing (!, ?, #)",
    },
  },
} as const;
