import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/auth/components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Parolni tiklash · Oqim Studio",
  description: "Parolni tiklash havolasini so'rash.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
