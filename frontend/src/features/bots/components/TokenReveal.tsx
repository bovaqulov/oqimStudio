"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";
import { revealBotTokenAction } from "../actions";

/**
 * The bot token, hidden until asked for.
 *
 * A token on screen is a token in a screenshot, a screen share and a support
 * ticket — so the page ships only the masked form, and the real one is fetched
 * from the server on the click that asks for it.
 *
 * The paragraph under the field is gone. It explained that the token is stored
 * encrypted (a property of our storage, not something the reader acts on) and
 * gave the @BotFather path for rotating it — which is a support answer, not a
 * caption every visitor to this panel has to read past. The eye now uses the
 * eye icon: it was drawn as an (i), so the one control that reveals a secret
 * looked like a help button.
 */
export function TokenReveal({ botId, masked }: { botId: string; masked: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const revealed = token !== null;

  async function reveal() {
    if (revealed) {
      setToken(null);
      return;
    }
    setLoading(true);
    try {
      const value = await revealBotTokenAction(botId);
      if (!value) {
        showToast("Tokenni ko'rish uchun ruxsat yo'q");
        return;
      }
      setToken(value);
    } catch {
      showToast("Tokenni olishda xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="t-footnote t-secondary">Bot tokeni</span>
      <div className="flex items-stretch overflow-hidden rounded-[12px] bg-neutral-800">
        <span className="min-w-0 flex-1 self-center truncate px-3.5 font-mono text-[15px] text-text">
          {revealed ? token : masked}
        </span>
        <button
          type="button"
          onClick={reveal}
          disabled={loading}
          aria-label={revealed ? "Yashirish" : "Ko'rsatish"}
          className="flex min-h-[44px] w-11 flex-none cursor-pointer items-center justify-center text-neutral-500 disabled:cursor-default disabled:opacity-40"
        >
          <Icon name={revealed ? "eye-slash" : "eye"} size={17} />
        </button>
        <button
          type="button"
          aria-label="Nusxalash"
          onClick={async () => {
            const value = token ?? (await revealBotTokenAction(botId));
            if (!value) {
              showToast("Tokenni nusxalash uchun ruxsat yo'q");
              return;
            }
            navigator.clipboard?.writeText(value).catch(() => {});
            showToast("Token nusxalandi");
          }}
          className="flex min-h-[44px] w-11 flex-none cursor-pointer items-center justify-center text-neutral-500"
        >
          <Icon name="copy" size={17} />
        </button>
      </div>
    </div>
  );
}
