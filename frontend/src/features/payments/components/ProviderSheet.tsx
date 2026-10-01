"use client";

import { useActionState, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ListButton, ListGroup, ListRow } from "@/components/ui/List";
import { Modal } from "@/components/ui/Modal";
import { MainButton, confirmDestructive } from "@/lib/telegram/MainButton";
import { hapticResult } from "@/lib/telegram/webapp";
import {
  connectPaymentProviderAction,
  disconnectPaymentProviderAction,
  enablePaymentProviderAction,
  verifyPaymentProviderAction,
} from "../actions";
import { CONNECT_INITIAL_STATE } from "../form-state";
import { getPaymentProvider, slugifyProviderId, type PaymentProviderDefinition } from "../providers";
import type { PaymentConnection } from "../types";

/**
 * One provider, opened.
 *
 * Whatever the reader came here to do, there is exactly one of it and it is on
 * Telegram's MainButton: switch Stars on, paste a token, or — once connected —
 * nothing, because the sheet is then a list of facts with a red row at the
 * bottom. Disconnecting asks through the client's own popup rather than through
 * a dialog of ours: an action nobody can undo should not be answered inside the
 * page that is asking about it.
 */
export function ProviderSheet({
  provider,
  connection,
  botId,
  canManage,
  onClose,
}: {
  provider: PaymentProviderDefinition;
  connection?: PaymentConnection;
  botId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const tokenless = provider.auth === "bot_token";
  const connected = Boolean(connection);
  // Open straight onto the token field when there is nothing connected yet:
  // that is the only reason to be on this sheet.
  const [editing, setEditing] = useState(!connected && !tokenless);
  // Nothing connected and nothing in the catalogue: this sheet was opened by
  // «Qo'shish», so the merchant names what they are connecting.
  const naming = !connected && !tokenless && !getPaymentProvider(provider.id);

  return (
    <Modal open onClose={onClose} labelledBy="provider-sheet-title" className="max-w-[480px]">
      <div className="flex flex-none items-center gap-3 px-4 py-3">
        <span
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[8px]"
          style={{ background: `${provider.accent}22`, color: provider.accent }}
        >
          <Icon name={provider.icon} size={17} weight={tokenless ? "fill" : "regular"} />
        </span>
        <span id="provider-sheet-title" className="t-headline min-w-0 flex-1 truncate">
          {provider.name}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="oq-press flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-neutral-500"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-6">
        {editing ? (
          <TokenForm
            naming={naming}
            provider={provider}
            botId={botId}
            replacing={connected}
            onCancel={connected ? () => setEditing(false) : onClose}
            onDone={onClose}
          />
        ) : connection ? (
          <ConnectedBody
            provider={provider}
            connection={connection}
            botId={botId}
            canManage={canManage}
            tokenless={tokenless}
            onReplace={() => setEditing(true)}
            onClose={onClose}
          />
        ) : (
          <EnableBody provider={provider} botId={botId} canManage={canManage} onClose={onClose} />
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

/** Stars: nothing to paste, so the sheet is a sentence and the MainButton. */
function EnableBody({
  provider,
  botId,
  canManage,
  onClose,
}: {
  provider: PaymentProviderDefinition;
  botId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={enablePaymentProviderAction} className="flex flex-col gap-6">
      <input type="hidden" name="botId" value={botId} />
      <input type="hidden" name="providerId" value={provider.id} />

      <p className="t-subhead t-secondary m-0 px-1">{provider.summary}</p>

      <ListGroup>
        <ListRow label="Valyuta" value={provider.currencies.join(", ")} />
        <ListLinkOut href={provider.docsUrl} />
      </ListGroup>

      {canManage && (
        <div className="flex md:justify-end">
          <MainButton
            inline
            text="Yoqish"
            onClick={() => {
              formRef.current?.requestSubmit();
              onClose();
            }}
          />
        </div>
      )}
    </form>
  );
}

/** Already on: the facts, then the one row that turns it off. */
function ConnectedBody({
  provider,
  connection,
  botId,
  canManage,
  tokenless,
  onReplace,
  onClose,
}: {
  provider: PaymentProviderDefinition;
  connection: PaymentConnection;
  botId: string;
  canManage: boolean;
  tokenless: boolean;
  onReplace: () => void;
  onClose: () => void;
}) {
  const verifyRef = useRef<HTMLFormElement>(null);
  const disconnectRef = useRef<HTMLFormElement>(null);

  async function disconnect() {
    const ok = await confirmDestructive({
      title: provider.name,
      message: tokenless
        ? `${provider.name} to'lovlari qabul qilinmaydi. Keyin qayta yoqish mumkin.`
        : `Token o'chiriladi va ${provider.name} to'lovlari qabul qilinmaydi.`,
      confirmText: tokenless ? "O'chirish" : "Uzish",
    });
    if (!ok) return;
    hapticResult("warning");
    disconnectRef.current?.requestSubmit();
    onClose();
  }

  return (
    <>
      <ListGroup>
        <ListRow
          label={tokenless ? "Ishlaydi" : "Token"}
          value={tokenless ? "Bot tokeni orqali" : (connection.tokenMasked ?? "—")}
        />
        {connection.mode && <ListRow label="Rejim" value={connection.mode === "live" ? "LIVE" : "TEST"} />}
        <ListRow label="Tekshirilgan" value={connection.lastCheckedAt} />
        <ListRow label="Valyuta" value={provider.currencies.join(", ")} />
      </ListGroup>

      {connection.error && (
        <p className="t-footnote m-0 flex items-start gap-2 px-1 text-danger-fg">
          <Icon name="warning" size={15} className="mt-px flex-none" />
          {connection.error}
        </p>
      )}

      {/* Outside the groups on purpose: an empty <form> between two rows breaks
          the adjacent-sibling rule that draws the hairline between them. */}
      <form ref={verifyRef} action={verifyPaymentProviderAction} hidden>
        <input type="hidden" name="botId" value={botId} />
        <input type="hidden" name="providerId" value={provider.id} />
      </form>
      <form ref={disconnectRef} action={disconnectPaymentProviderAction} hidden>
        <input type="hidden" name="botId" value={botId} />
        <input type="hidden" name="providerId" value={provider.id} />
      </form>

      <ListGroup>
        <ListButton label="Tekshirish" disabled={!canManage} onClick={() => verifyRef.current?.requestSubmit()} />
        {!tokenless && <ListButton label="Tokenni o'zgartirish" disabled={!canManage} onClick={onReplace} chevron />}
        <ListLinkOut href={provider.docsUrl} />
      </ListGroup>

      <ListGroup>
        <ListButton
          label={tokenless ? "O'chirish" : "Uzish"}
          destructive
          disabled={!canManage}
          onClick={disconnect}
        />
      </ListGroup>
    </>
  );
}

/** The token field. One input, one (i), one MainButton. */
function TokenForm({
  provider,
  botId,
  replacing,
  naming,
  onCancel,
  onDone,
}: {
  provider: PaymentProviderDefinition;
  botId: string;
  replacing: boolean;
  /** A connection being created rather than one being re-tokened: it needs a name. */
  naming: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(connectPaymentProviderAction, CONNECT_INITIAL_STATE);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 pt-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success-fg">
          <Icon name="check-circle" size={26} />
        </span>
        <p className="t-headline m-0">{provider.name} ulandi</p>
        <p className="t-subhead t-secondary m-0 max-w-[300px]">{state.message}</p>
        <MainButton inline text="Tayyor" onClick={onDone} />
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="botId" value={botId} />
      <input type="hidden" name="providerId" value={naming ? slugifyProviderId(name) : provider.id} />

      {/* Only while the connection is being created. The name *is* the id —
          nothing stores it twice, so nothing can disagree with it — which is
          also why it cannot be changed afterwards: a rename would be a
          different row, and the invoice blocks pointing at the old one would
          quietly stop billing. */}
      {naming && (
        <label className="flex flex-col gap-2">
          <span className="t-footnote t-secondary">Nomi</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
            maxLength={48}
            placeholder="Click"
            aria-label="To'lov tizimi nomi"
            className="h-11 rounded-[12px] border-none bg-neutral-800 px-3.5 text-[15px] text-text placeholder:text-neutral-600 focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset focus-visible:outline-none"
          />
          <span className="t-footnote t-tertiary px-1">
            O&apos;zingiz uchun nom — ro&apos;yxatda shu ko&apos;rinadi.
          </span>
        </label>
      )}

      <label className="flex flex-col gap-2">
        <span className="t-footnote t-secondary">Provider token</span>
        <span className="flex h-11 items-stretch overflow-hidden rounded-[12px] bg-neutral-800 focus-within:ring-2 focus-within:ring-accent-500 focus-within:ring-inset">
          <input
            name="token"
            type={visible ? "text" : "password"}
            required
            autoFocus={!naming}
            autoComplete="off"
            spellCheck={false}
            placeholder={provider.tokenExample}
            aria-label="Provider token"
            className="min-w-0 flex-1 border-none bg-transparent px-3.5 font-mono text-[15px] text-text placeholder:truncate placeholder:font-sans placeholder:text-neutral-600 focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? "Tokenni yashirish" : "Tokenni ko'rsatish"}
            className="w-11 flex-none cursor-pointer text-neutral-500"
          >
            <Icon name={visible ? "eye-slash" : "eye"} size={17} className="mx-auto" />
          </button>
        </span>
      </label>

      {/* The one sentence on this sheet, and it is the answer to the only
          question a merchant has here: where do I get this. */}
      {provider.tokenHint && <p className="t-footnote t-tertiary m-0 px-1 leading-[18px]">{provider.tokenHint}</p>}

      {state.status === "error" && state.message && (
        <p className="t-footnote m-0 flex items-start gap-2 px-1 text-danger-fg" role="alert">
          <Icon name="warning" size={15} className="mt-px flex-none" />
          {state.message}
        </p>
      )}

      {/* A dialog's own footer, not the page's.
      
          `MainButton` pins itself to the corner of the viewport by default,
          which is right for a screen and wrong inside a sheet: the primary
          action ended up a thousand pixels from the field it submits, outside
          the dialog it belongs to, while «Bekor qilish» stayed in. `inline`
          exists for exactly this and its own doc comment describes this
          picture.
      
          Reversed on a phone so the action a thumb reaches for is the lower of
          the two; a row from `md` up, where the pointer is precise and a
          dialog's confirm sits on the right. */}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-end md:gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="oq-press t-body min-h-[44px] cursor-pointer px-1 text-accent-400"
        >
          Bekor qilish
        </button>
        <MainButton
          inline
          text={replacing ? "Saqlash" : "Ulash"}
          onClick={() => formRef.current?.requestSubmit()}
        />
      </div>
    </form>
  );
}

/** The provider's own documentation, as a row rather than as a technical label. */
function ListLinkOut({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="oq-row">
      <span className="t-body min-w-0 flex-1">Qo&apos;llanma</span>
      <Icon name="link" size={17} className="flex-none text-neutral-600" />
    </a>
  );
}
