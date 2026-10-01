"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { createInviteLinkAction } from "../actions";
import { ROLE_DEFINITIONS } from "../roles";
import type { MemberRole, WorkspaceInviteLink } from "../types";

/**
 * Inviting somebody who is reachable in Telegram rather than by email.
 *
 * The form above this one needs an address to send to, which is the wrong shape
 * for most of the teams using this: the person inviting knows the chat, not the
 * mailbox. So this produces a code and hands it back, and getting it to the
 * right person is the inviter's job — the only part of this they were ever
 * better at than we are.
 *
 * Two ways out, and they are not the same button twice. "Telegramda yuborish"
 * opens Telegram's own share sheet with the chat picker up and the message
 * already written, which is the whole journey in one tap. Copying is the escape
 * hatch for everywhere else — a group description, a WhatsApp message, a
 * whiteboard.
 *
 * The link is single use and says so. A team link that stays open is a link
 * still open next month in a group chat somebody has left, and the cost of a
 * second person is one more press of this button.
 */
export function InviteLinkPanel({ defaultRole = "editor" }: { defaultRole?: MemberRole }) {
  const [role, setRole] = useState<MemberRole>(defaultRole);
  const [link, setLink] = useState<WorkspaceInviteLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await createInviteLinkAction(role);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setLink(result.link);
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      showToast("Havola nusxalandi");
    } catch {
      // Clipboard access can be refused outright — over plain HTTP, or by a
      // permission the reader has already denied. The link is on screen and
      // selectable either way, so the honest answer is to say so.
      showToast("Nusxalab bo'lmadi — havolani qo'lda belgilang", { tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="t-footnote t-secondary">Rol</span>
          <Select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
            {ROLE_DEFINITIONS.filter((definition) => definition.key !== "owner").map((definition) => (
              <option key={definition.key} value={definition.key}>
                {definition.label}
              </option>
            ))}
          </Select>
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="oq-press t-body flex h-11 flex-none cursor-pointer items-center gap-1.5 rounded-[12px] bg-accent-700 px-4 text-white disabled:cursor-default disabled:opacity-40"
        >
          <Icon name="link" size={15} />
          {pending ? "…" : link ? "Yangi havola" : "Havola yaratish"}
        </button>
      </div>

      {error && (
        <p role="alert" className="t-footnote m-0 text-danger-fg">
          {error}
        </p>
      )}

      {link && (
        <div className="flex flex-col gap-2.5">
          {/* Shown, not just copied: a link the reader can see is a link they
              can check before sending it to somebody. */}
          <div className="flex items-stretch overflow-hidden rounded-[12px] bg-neutral-800">
            <span className="min-w-0 flex-1 self-center truncate px-3.5 font-mono text-[13px] text-text">
              {link.url}
            </span>
            <button
              type="button"
              onClick={copy}
              aria-label="Nusxalash"
              className="flex min-h-[44px] w-11 flex-none cursor-pointer items-center justify-center text-neutral-500 hover:text-neutral-100"
            >
              <Icon name="copy" size={16} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={link.telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="oq-press t-body flex min-h-[44px] flex-none items-center gap-1.5 rounded-[12px] bg-accent-800 px-3.5 text-accent-ink"
            >
              <Icon name="telegram-logo" size={16} />
              Telegramda yuborish
            </a>
            <span className="t-footnote t-secondary">
              Bir marta ishlaydi · {link.expiresAt} gacha
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
