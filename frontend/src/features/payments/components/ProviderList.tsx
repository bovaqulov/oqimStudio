"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ListButton, ListGroup } from "@/components/ui/List";
import { customProvider, type PaymentProviderDefinition } from "../providers";
import type { PaymentConnection } from "../types";
import { ProviderSheet } from "./ProviderSheet";

/**
 * The bot's payment providers, as one list.
 *
 * What it replaces: five cards, each with a full-width filled blue button on
 * it. Five primary actions on one screen is no primary action at all — and
 * "Ulash" is not even a thing that happens on this screen, it is a thing that
 * happens after a token has been pasted somewhere else. So the screen states
 * five facts (this one is on, that one is not) and each row leads to the one
 * place where its single action lives.
 */
export function ProviderList({
  providers,
  connections,
  botId,
  canManage,
}: {
  providers: PaymentProviderDefinition[];
  connections: PaymentConnection[];
  botId: string;
  canManage: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A connection being created has no id yet — that is the whole point, the
  // merchant is about to name it — so it cannot be addressed by `openId`.
  const [adding, setAdding] = useState(false);
  const open = providers.find((provider) => provider.id === openId);
  const openConnection = connections.find((item) => item.providerId === openId);

  return (
    <>
      <ListGroup inset="icon">
        {providers.map((provider) => {
          const connection = connections.find((item) => item.providerId === provider.id);
          return (
            <ListButton
              key={provider.id}
              icon={provider.icon}
              iconTone={connection?.status.tone === "success" ? "success" : "neutral"}
              label={provider.name}
              value={statusText(provider, connection)}
              onClick={() => setOpenId(provider.id)}
              chevron
            />
          );
        })}
      </ListGroup>

      {/* A bot has as many payment systems as it has merchant accounts. The
          catalogue carries one row — Telegram Stars, which needs no account —
          and every other row is a connection somebody added here. */}
      {canManage && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="oq-press t-body flex min-h-[44px] cursor-pointer items-center gap-2 self-start px-1 text-accent-400"
        >
          <Icon name="plus" size={16} className="flex-none" />
          To&apos;lov tizimi qo&apos;shish
        </button>
      )}

      {adding && (
        <ProviderSheet
          provider={customProvider("", "Yangi to'lov tizimi")}
          botId={botId}
          canManage={canManage}
          onClose={() => setAdding(false)}
        />
      )}

      {open && (
        <ProviderSheet
          provider={open}
          connection={openConnection}
          botId={botId}
          canManage={canManage}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/** The right-hand column: one word for where this provider stands. */
function statusText(provider: PaymentProviderDefinition, connection?: PaymentConnection): string {
  const tokenless = provider.auth === "bot_token";
  if (!connection) return tokenless ? "O'chiq" : "Ulanmagan";
  if (connection.status.tone !== "success") return connection.status.label;
  if (tokenless) return "Yoqilgan";
  return connection.mode === "live" ? "LIVE" : "TEST";
}
