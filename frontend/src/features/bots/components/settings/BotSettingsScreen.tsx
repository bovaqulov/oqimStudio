"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Input, Textarea } from "@/components/ui/Input";
import { ListButton, ListGroup, ListRow } from "@/components/ui/List";
import { Segmented } from "@/components/ui/Segmented";
import { Toggle } from "@/components/ui/Toggle";
import { showToast } from "@/components/ui/toast-store";
import { MainButton, confirmDestructive } from "@/lib/telegram/MainButton";
import { useUnsavedGuard } from "@/lib/telegram/useUnsavedGuard";
import { hapticResult } from "@/lib/telegram/webapp";
// Straight from the modules, not the feature barrel: the barrel re-exports the
// workspace repository, which is `server-only`, and a client component that
// pulls it in fails the build (see CLAUDE.md).
import { canEditContent, canManageWorkspace } from "@/features/workspace/roles";
import type { MemberRole } from "@/features/workspace/types";
import { BotActivityList } from "../BotActivityList";
import { BotConnectionPanel } from "../BotConnectionPanel";
import { disconnectBotAction, moveBotToProjectAction, setBotPausedAction, updateBotSettingsAction } from "../../actions";
import { BOT_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_TAGS, MAX_BOT_LANGUAGES } from "../../languages";
import { BOT_SETTINGS_INITIAL_STATE } from "../../form-state";
import type { Bot, BotLanguage, BotLanguages, BotSettings } from "../../types";
import { EditSheet } from "./EditSheet";

/**
 * What stopping the bot actually does, said in one sentence.
 *
 * The same bytes as `apps.bots.models.PAUSED_NOTE`, which is what the chat rows
 * say while the bot is stopped, and `apps/bots/tests.py` asserts the two match.
 * It is written out rather than derived because the reason for saying it here
 * is the reason for saying it there: the button this replaced promised
 * something else again — "bot xabarlarga javob bermaydi" — which was both a
 * third wording and a claim this product cannot make.
 */
// One literal on one line, not two joined with `+`: the check compares bytes,
// and a sentence split across a concatenation is a sentence it cannot find.
const PAUSED_NOTE = "Bot to'xtatilgan — yangi suhbat boshlamaydi. Kelgan xabarlar «Suhbatlar» bo'limida saqlanadi, allaqachon boshlangan suhbatlar esa oxiriga yetadi.";

/** Which row's sheet is open. `null` is the list itself. */
type Sheet = "profile" | "description" | "shortDescription" | "languages" | "project" | null;

interface Draft {
  displayName: string;
  description: string;
  shortDescription: string;
  avatarEmoji: string;
  languages: BotLanguages;
}

function toDraft(settings: BotSettings): Draft {
  return {
    displayName: settings.displayName,
    description: settings.description,
    shortDescription: settings.shortDescription,
    avatarEmoji: settings.avatarEmoji,
    languages: settings.languages,
  };
}

/**
 * A bot's settings, as iOS Settings.
 *
 * What this replaces: four folding panels of stacked label / input / grey
 * paragraph, several of which named a Bot API method at the reader
 * ("setMyName", "setMyDescription") — who has never called one and never will.
 * Every one of those sentences is gone. What a field *is* is now said by the
 * value printed on its own row, which is both shorter and truer: a row reading
 * "Tavsif · Buyurtma qabul qilaman" needs no explanation of what a description
 * is for.
 *
 * It is still one form. Every value is carried in a hidden input inside it
 * whether or not the sheet that edits it is open, so the same server action
 * reads the same whole payload it always did — a partial post would blank the
 * fields it did not carry.
 */
export function BotSettingsScreen({
  bot,
  role,
  projects,
}: {
  bot: Bot;
  role: MemberRole;
  /** Every project of this workspace, so the bot can be moved into one. */
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const canEdit = canEditContent(role);
  const canManage = canManageWorkspace(role);

  const [state, formAction] = useActionState(updateBotSettingsAction, BOT_SETTINGS_INITIAL_STATE);
  const [draft, setDraft] = useState<Draft>(() => toDraft(bot.settings));
  const [sheet, setSheet] = useState<Sheet>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // What "unchanged" means, re-set every time a save lands: afterwards the
  // values on screen *are* the stored ones, and a save button that stays up
  // says the opposite.
  const [baseline, setBaseline] = useState(() => JSON.stringify(toDraft(bot.settings)));
  const dirty = useMemo(() => JSON.stringify(draft) !== baseline, [draft, baseline]);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useUnsavedGuard(dirty && canEdit);

  useEffect(() => {
    if (state.status === "idle") return;
    const saved = state.status === "saved";
    hapticResult(saved ? "success" : "error");
    showToast(state.message ?? (saved ? "Saqlandi" : "Saqlab bo'lmadi"), saved ? undefined : { tone: "danger" });
    // Through the ref, so this runs on an answer from the server and not on
    // every keystroke that changed the draft since.
    if (saved) setBaseline(JSON.stringify(draftRef.current));
  }, [state]);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  const languageSummary = draft.languages.enabled.map((code) => LANGUAGE_TAGS[code]).join(" · ");

  // Held in state rather than read from `bot` on every render: the row has to
  // show the new project the moment it is picked, and the page behind it is
  // only revalidated once the write lands.
  const [projectId, setProjectId] = useState(bot.projectId);
  const projectName = projects.find((project) => project.id === projectId)?.name ?? "Loyiha";
  const [, startMove] = useTransition();

  function moveTo(next: string) {
    const previous = projectId;
    setProjectId(next);
    setSheet(null);
    startMove(async () => {
      const outcome = await moveBotToProjectAction(bot.id, next);
      if (outcome.ok) {
        showToast("Loyiha o'zgartirildi");
        router.refresh();
        return;
      }
      setProjectId(previous);
      showToast(outcome.message, { tone: "danger" });
    });
  }

  async function disconnect() {
    const ok = await confirmDestructive({
      title: "Botni uzish",
      message: `${bot.handle} Telegramdan uziladi. Oqimlar saqlanadi.`,
      confirmText: "Uzish",
    });
    if (!ok) return;
    const data = new FormData();
    data.set("botId", bot.id);
    await disconnectBotAction(data);
    router.refresh();
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-6 pb-4">
      <HiddenState botId={bot.id} draft={draft} />

      {/* --------------------------- Who this bot is ------------------------ */}
      <header className="flex flex-col items-center gap-2 pt-2">
        <button
          type="button"
          disabled={!canEdit}
          aria-label="Nom va belgini o'zgartirish"
          onClick={() => setSheet("profile")}
          className="oq-press flex h-[86px] w-[86px] cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-[42px] disabled:cursor-default"
        >
          {draft.avatarEmoji || "🤖"}
        </button>
        <h1 className="t-title2 m-0 text-center">{draft.displayName || bot.handle}</h1>
        <p className="t-subhead t-secondary m-0">{bot.handle}</p>
      </header>

      {/* ------------------------------ Wiring ------------------------------ */}
      {/* How the bot is connected, one row above the settings it belongs with.
          It used to greet the reader at the top of the bot's own page, which is
          the screen they open to look at flows — a token and a webhook verdict
          are the answer to a question nobody asks until something is broken,
          and this is where they come looking when it is. Collapsed it is a
          single row, and it opens itself when the answer is "muammo bor". */}
      <BotConnectionPanel
        botId={bot.id}
        handle={bot.handle}
        tokenMasked={bot.tokenMasked}
        webhook={bot.webhook}
        canEdit={canEdit}
      />

      {/* ------------------------------ Profile ----------------------------- */}
      <ListGroup title="Profil">
        <ListButton
          label="Nom"
          value={draft.displayName}
          onClick={() => setSheet("profile")}
          chevron
          disabled={!canEdit}
        />
        <ListButton
          label="Tavsif"
          value={draft.description || "Yo'q"}
          onClick={() => setSheet("description")}
          chevron
          disabled={!canEdit}
        />
        <ListButton
          label="Qisqa tavsif"
          value={draft.shortDescription || "Yo'q"}
          onClick={() => setSheet("shortDescription")}
          chevron
          disabled={!canEdit}
        />
      </ListGroup>

      {/* ------------------------------ Project ----------------------------- */}
      {/* Which project the bot belongs to has been changeable since the
          endpoint existed and offered on no screen, so a bot connected into
          the wrong project stayed there. Not in the group above: the three
          rows there are how the bot presents itself to a customer, and this
          one is where it is filed. Only when there is more than one project to
          choose — a row whose sheet has a single option is a chevron leading
          to a dead end.

          No group title on it either: it would be the word "Loyiha" printed
          directly above the row that says "Loyiha", which is the heading
          twice. */}
      {projects.length > 1 && (
        <ListGroup footer="Botning oqimlari ham u bilan birga ko'chadi.">
          <ListButton
            label="Loyiha"
            value={projectName}
            onClick={() => setSheet("project")}
            chevron
            disabled={!canEdit}
          />
        </ListGroup>
      )}

      {/* ------------------------------ Language ---------------------------- */}
      <ListGroup title="Til">
        <ListButton
          label="Bot tillari"
          value={languageSummary}
          onClick={() => setSheet("languages")}
          chevron
          disabled={!canEdit}
        />
      </ListGroup>

      {/* ------------------------------- Stopping --------------------------- */}
      {/* The «Ish vaqti» section stood here: a switch, the weekdays, an opening
          and a closing time, a timezone and an away message, and not one line
          anywhere that read any of them. Hours are answered per flow instead,
          where two flows can answer the same hour differently — that is what
          the «Ish vaqtidan tashqari avtojavob» template is. See
          `apps/bots/migrations/0010_drop_bot_working_hours.py`.

          What is here instead is the switch that section was standing in front
          of: the one control on this screen that is about the bot rather than
          about how it presents itself. */}
      <PauseSwitch botId={bot.id} paused={bot.isPaused} canManage={canManage} />

      {/* Its own group, at the bottom, as red text on a row — never a filled
          button, and never where a thumb rests by default. */}
      {canManage && (
        <ListGroup>
          <ListButton label="Botni uzish" destructive onClick={disconnect} />
        </ListGroup>
      )}

      {!canEdit && (
        <p className="t-footnote t-tertiary m-0 px-4">
          Sozlamalarni faqat egasi va adminlar o&apos;zgartiradi.
        </p>
      )}

      {/* ------------------------------ The trail --------------------------- */}
      {/* What has been done to this bot. It was folded into «Ko'rsatkichlar va
          faoliyat» under the flow list, behind an hour of counters that are
          `/analytics`'s job; the counters are gone and this is here, which is
          where the questions it answers get asked — who revealed the token, who
          stopped the bot, why Telegram refused a webhook. Read-only, so it sits
          below the last control rather than among them. */}
      {bot.activity.length > 0 && (
        <div className="px-4">
          <BotActivityList activity={bot.activity} />
        </div>
      )}

      {/* The screen's one action, and only while there is something to save.
          Not rendered while a sheet is open — the sheet owns the button then,
          and two components driving one native button is one too many. */}
      {canEdit && sheet === null && (
        <MainButton text="Saqlash" visible={dirty} onClick={() => formRef.current?.requestSubmit()} />
      )}

      {/* ------------------------------- Sheets ----------------------------- */}
      {sheet === "profile" && (
        <EditSheet title="Nom" onClose={() => setSheet(null)}>
          {/* No field label on either control: the sheet is titled "Nom" and
              the avatar is a picture of itself. A label under a heading that
              says the same word is the heading printed twice. */}
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-2">
              <span className="t-footnote t-secondary">Rasm</span>
              <input
                value={draft.avatarEmoji}
                onChange={(event) => patch({ avatarEmoji: event.target.value.slice(0, 4) })}
                maxLength={4}
                aria-label="Bot belgisi"
                className="h-11 w-[62px] rounded-[12px] border-0 bg-neutral-800 text-center text-[24px] outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-2">
              <Input
                value={draft.displayName}
                aria-label="Bot nomi"
                onChange={(event) => patch({ displayName: event.target.value })}
                placeholder="Anvar Market"
                autoFocus
              />
            </label>
          </div>
        </EditSheet>
      )}

      {sheet === "description" && (
        <EditSheet title="Tavsif" onClose={() => setSheet(null)}>
          <Textarea
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
            rows={4}
            autoFocus
            placeholder="Buyurtma qabul qilaman va yetkazib berish narxini aytaman"
          />
        </EditSheet>
      )}

      {sheet === "shortDescription" && (
        <EditSheet title="Qisqa tavsif" onClose={() => setSheet(null)}>
          <Textarea
            value={draft.shortDescription}
            onChange={(event) => patch({ shortDescription: event.target.value })}
            rows={3}
            autoFocus
            placeholder="24/7 buyurtma qabul qiladi"
          />
        </EditSheet>
      )}

      {sheet === "languages" && (
        <EditSheet title="Bot tillari" onClose={() => setSheet(null)} detent="full">
          <LanguageSheet languages={draft.languages} onChange={(languages) => patch({ languages })} />
        </EditSheet>
      )}

      {sheet === "project" && (
        <EditSheet title="Loyiha" onClose={() => setSheet(null)} detent="full">
          {/* Picked, not drafted: this one writes on the tap rather than
              waiting for «Saqlash», because moving a bot is a filing decision
              with nothing else on the screen to save alongside it. */}
          <div className="oq-group">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => moveTo(project.id)}
                className="oq-row w-full cursor-pointer"
              >
                <span className="t-body min-w-0 flex-1 truncate text-left">{project.name}</span>
                {project.id === projectId && <Icon name="check" size={18} className="flex-none text-accent-500" />}
              </button>
            ))}
          </div>
        </EditSheet>
      )}

    </form>
  );
}

/**
 * The one switch on this screen that is about the bot rather than about how it
 * presents itself.
 *
 * What it replaces was a button in the bot header's overflow menu reading
 * «To'xtatish», behind a destructive confirmation promising *"Bot to'xtatiladi
 * va xabarlarga javob bermaydi"*. It fired a toast and nothing else — no
 * request, no column, no runtime effect — so a shop owner who stopped their bot
 * on a Friday evening watched it answer customers all weekend while the panel
 * agreed with them that it was stopped.
 *
 * Deliberately outside the form. The rest of this screen is a draft the reader
 * saves when they are finished; stopping a bot is something they mean *now*,
 * and a switch that needed a second press on «Saqlash» to take effect is the
 * same failure in a quieter register. So it writes immediately, optimistically,
 * and puts itself back with the reason if the write is refused.
 *
 * The footer says what stopping actually does, including the two halves that
 * are easy to assume otherwise: a conversation already in progress is finished
 * rather than abandoned mid-order, and nothing is lost — every message still
 * reaches «Suhbatlar» for an operator to answer by hand.
 */
function PauseSwitch({
  botId,
  paused,
  canManage,
}: {
  botId: string;
  paused: boolean;
  canManage: boolean;
}) {
  const [on, setOn] = useState(paused);
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  function toggle() {
    const next = !on;
    setError("");
    setOn(next);
    startTransition(async () => {
      const outcome = await setBotPausedAction(botId, next);
      if (outcome.ok) {
        hapticResult(next ? "warning" : "success");
        showToast(next ? "Bot to'xtatildi" : "Bot ishga tushdi", next ? { tone: "danger" } : undefined);
        return;
      }
      setOn(!next);
      setError(outcome.message);
    });
  }

  return (
    <ListGroup
      title="Ishlash holati"
      footer={
        error ||
        (on
          ? PAUSED_NOTE
          : "Bot ishlayapti. To'xtatsangiz yangi suhbatlar boshlanmaydi — oqimlar, kontaktlar va sozlamalar joyida qoladi.")
      }
    >
      <ListRow>
        <span className="t-body min-w-0 flex-1">{on ? "To'xtatilgan" : "Ishlayapti"}</span>
        <Toggle
          checked={!on}
          onToggle={toggle}
          disabled={!canManage}
          label="Bot ishlashi"
        />
      </ListRow>
    </ListGroup>
  );
}

/**
 * The whole draft as form fields.
 *
 * Rendered whether or not the sheet that edits a value is open: the server
 * action reads the full settings object out of one `FormData` and writes what
 * it finds there, so a field missing from the post is a field wiped from the
 * bot.
 */
function HiddenState({ botId, draft }: { botId: string; draft: Draft }) {
  return (
    <>
      <input type="hidden" name="botId" value={botId} />
      <input type="hidden" name="displayName" value={draft.displayName} />
      <input type="hidden" name="description" value={draft.description} />
      <input type="hidden" name="shortDescription" value={draft.shortDescription} />
      <input type="hidden" name="avatarEmoji" value={draft.avatarEmoji} />

      <input type="hidden" name="mainLanguage" value={draft.languages.main} />
      {draft.languages.enabled.map((code) => (
        <input key={code} type="hidden" name="languages" value={code} />
      ))}
    </>
  );
}

/**
 * Which languages the bot is written in, and which one every message is
 * guaranteed to exist in.
 *
 * The cap and the "the main one is always on" rule are the only two things a
 * row of switches cannot say for itself, which is the whole reason this has
 * logic rather than being three more list rows.
 */
function LanguageSheet({
  languages,
  onChange,
}: {
  languages: BotLanguages;
  onChange: (languages: BotLanguages) => void;
}) {
  const atLimit = languages.enabled.length >= MAX_BOT_LANGUAGES;

  return (
    <div className="flex flex-col gap-5">
      <div className="oq-group">
        {BOT_LANGUAGES.map((code) => {
          const on = languages.enabled.includes(code);
          const isMain = languages.main === code;
          return (
            <label key={code} className="oq-row cursor-pointer">
              <span className="t-body min-w-0 flex-1">{LANGUAGE_LABELS[code]}</span>
              <Toggle
                checked={on}
                // The main language cannot be switched off here; choosing a
                // different main is how it is turned off.
                disabled={isMain || (atLimit && !on)}
                label={LANGUAGE_LABELS[code]}
                onToggle={() =>
                  onChange({
                    ...languages,
                    enabled: on
                      ? languages.enabled.filter((item) => item !== code)
                      : [...languages.enabled, code],
                  })
                }
              />
            </label>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <span className="t-footnote t-secondary px-1">Asosiy til</span>
        <Segmented
          label="Asosiy til"
          value={languages.main}
          onChange={(main: BotLanguage) =>
            onChange({
              main,
              enabled: languages.enabled.includes(main) ? languages.enabled : [...languages.enabled, main],
            })
          }
          options={BOT_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_TAGS[code] }))}
        />
      </div>
    </div>
  );
}

