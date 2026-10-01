import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, authLinkClasses } from "@/features/auth/components/AuthCard";

export const metadata: Metadata = {
  title: "Foydalanish shartlari · Oqim Studio",
  description: "Oqim Studio hisobini ochish va ishlatish shartlari.",
};

/**
 * The document the sign-up form makes people agree to, where they can read it.
 *
 * It used to link to `/help`, which lives in the app shell: that shell resolves
 * a session before it renders, so a signed-out reader following the one
 * mandatory link on the sign-up form was bounced to /login — and the form they
 * came from, half filled in, was gone. A required agreement whose text cannot
 * be opened without an account is an agreement to nothing.
 *
 * It sits in `(auth)` for exactly that reason: the group has no sidebar, no
 * workspace and no session read, and `proxy.ts` does not list it as protected,
 * so this renders for somebody who has never signed in. Everything below is a
 * plain statement of what the product does with what it is given — the parts
 * the code can be checked against — rather than a licence written in a voice
 * this product does not otherwise speak in.
 */
const SECTIONS: { title: string; body: string }[] = [
  {
    title: "Hisob",
    body:
      "Hisob email va parol bilan yoki Telegram orqali ochiladi. Telegram orqali ochilgan hisobda email manzil " +
      "bo'lmaydi — kirish har safar Telegram orqali bo'ladi. Hisobdagi ism va manzil faqat sizni tanish uchun " +
      "ishlatiladi; ular ish maydoningizdagi jamoaga ko'rinadi.",
  },
  {
    title: "Bot tokeni",
    body:
      "Botni ulaganingizda uning @BotFather bergan tokeni saqlanadi — usiz bot nomidan xabar yuborib bo'lmaydi. " +
      "Token ish maydoningizga tegishli va faqat shu ish maydoni a'zolariga ko'rinadi. Botni o'chirsangiz token " +
      "ham o'chadi, webhook esa Telegram tomonidan uziladi.",
  },
  {
    title: "Mijoz xabarlari",
    body:
      "Botingizga kelgan xabarlar, kontaktlar va oqim yurishi tarixi ish maydoningizda saqlanadi: usiz bot javob " +
      "bera olmaydi va analitika ko'rsatadigan raqam bo'lmaydi. Bu ma'lumot boshqa ish maydonlariga ko'rinmaydi va " +
      "sotilmaydi.",
  },
  {
    title: "Sizning javobgarligingiz",
    body:
      "Bot nomidan boradigan har bir xabar — sizniki. Telegram qoidalariga zid, spam yoki noqonuniy tarqatma " +
      "uchun javobgarlik oqimni yozgan ish maydonida qoladi. Telegram bunday botni o'zi to'xtatishi mumkin, va bu " +
      "holatda mahsulot ichida qiladigan hech narsa yordam bermaydi.",
  },
  {
    title: "Xizmat uzilishi",
    body:
      "Mahsulot Telegram Bot API ustida ishlaydi. Telegram tomonidagi uzilish, limit yoki o'zgarish botingizga " +
      "ta'sir qiladi — bunday paytda oqimlar to'xtaydi va uzilish tugagach o'zi tiklanadi.",
  },
  {
    title: "Ma'lumotni o'chirish",
    body:
      "Ish maydoni egasi istalgan paytda botni, oqimlarni va kontaktlarni o'chirishi mumkin — o'chirilgan yozuv " +
      "qaytarilmaydi. Hisobni butunlay yopish uchun qo'llab-quvvatlashga yozing.",
  },
];

export default function TermsPage() {
  return (
    <AuthCard
      title="Foydalanish shartlari"
      width={560}
      footer={
        <>
          {/* Back to the form, not to the app: whoever is reading this arrived
              from a half-filled sign-up form and has nowhere else to be. */}
          <Link href="/signup" className={authLinkClasses}>
            Ro&apos;yxatdan o&apos;tishga qaytish
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {SECTIONS.map((section) => (
          <section key={section.title} className="flex flex-col gap-1.5">
            <h2 className="t-headline m-0">{section.title}</h2>
            <p className="t-subhead t-secondary m-0 leading-[21px]">{section.body}</p>
          </section>
        ))}
        <p className="t-footnote t-tertiary m-0">
          Savol bo&apos;lsa:{" "}
          <a
            href="https://t.me/oqimstudio_support"
            target="_blank"
            rel="noreferrer"
            className="text-accent-400"
          >
            @oqimstudio_support
          </a>
        </p>
      </div>
    </AuthCard>
  );
}
