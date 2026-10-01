"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { Field, Input } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { MainButton } from "@/lib/telegram/MainButton";
import { botCreateStatusAction, connectBotAction, openBotCreateRequestAction } from "../actions";
import { CONNECT_BOT_INITIAL_STATE } from "../form-state";
import { validateBotToken } from "../lib/telegram-profile";
import type { ManagedBotConfig } from "../types";

/** How often the screen asks whether the bot has arrived, while the reader is away. */
const POLL_MS = 2000;
/*
 * How long it keeps asking.
 *
 * The wait has no natural end on our side — Telegram tells us nothing until the
 * reader confirms a screen on their own device, and if they close that screen
 * it tells us nothing ever. So the page said "Telegramda tasdiqlashni
 * kutmoqdamiz…" and went on saying it, with one link out and no way to stop.
 * Five minutes is longer than confirming a bot takes and short enough that
 * somebody who gave up is not left watching a sentence that will never change.
 */
const GIVE_UP_MS = 5 * 60 * 1000;

/**
 * "Botni ulash", on Telegram's own button.
 *
 * `useFormStatus` has to be read from inside the form, which is why this is a
 * component rather than a prop — and it is the only thing on this screen that
 * knows the submit is still in flight.
 */
function SubmitButton({ formRef }: { formRef: RefObject<HTMLFormElement | null> }) {
  const { pending } = useFormStatus();
  return (
    <MainButton
      text="Botni ulash"
      loading={pending}
      inline
      onClick={() => formRef.current?.requestSubmit()}
    />
  );
}

/**
 * Why a bot cannot be added, in the reader's terms rather than the API's.
 *
 * Three of the four say the same thing to every workspace, so they are written
 * here. The fourth cannot be: `plan_limit` names the plan, the cap and how
 * many are in use, and only the server holds those — `managed.message` carries
 * its sentence and this entry is the fallback for a payload that arrives
 * without one.
 */
const UNAVAILABLE: Record<Exclude<ManagedBotConfig["reason"], "">, string> = {
  plan_limit: "Tarifingizda yangi bot uchun joy qolmadi.",
  not_configured: "Bu o'rnatmada bot yaratuvchi bot sozlanmagan — tokenni @BotFather'dan olib joylashtiring.",
  telegram_required:
    "Yangi bot uni yaratgan Telegram hisobiga biriktiriladi, shuning uchun avval Telegram orqali kirish kerak.",
  management_off:
    "Boshqaruvchi botga @BotFather'da bot yaratish rejimi yoqilmagan — Mini App'dan «Bot Management Mode» ni yoqing.",
};

/**
 * One line saying why this cannot be done, in place of the control that would
 * have done it.
 *
 * A full plan is the only one of the four with somewhere to go, so it is the
 * only one that gets a link — every other reason is somebody else's setting
 * and a link would be a dead end. Same shape the flow wizard uses for the same
 * refusal.
 */
function Unavailable({ managed }: { managed: ManagedBotConfig }) {
  const reason = managed.reason as Exclude<ManagedBotConfig["reason"], "">;
  return (
    <p className="t-footnote t-secondary m-0 flex flex-wrap items-start gap-x-2 gap-y-1">
      <Icon name="info" size={15} className="mt-px flex-none" />
      <span className="min-w-0 flex-1">{managed.message || UNAVAILABLE[reason]}</span>
      {managed.reason === "plan_limit" && (
        <Link href="/billing" className="text-accent-400 underline-offset-2 hover:underline">
          Tariflar
        </Link>
      )}
    </p>
  );
}

/**
 * Two ways to end up with a bot in this project, and they are genuinely
 * different jobs rather than two spellings of one.
 *
 * **Ulash** is for a bot that already exists: it asks for the one secret
 * nobody else can supply and nothing more — the name and `@username` come back
 * from Telegram with the token, so asking for them only creates a way to be
 * wrong about your own bot.
 *
 * **Yaratish** is for a bot that does not exist yet. Until Bot API 9.6 that
 * meant leaving the product for a conversation with @BotFather and coming back
 * with something to paste; now the manager bot can own it, so the whole detour
 * is a link and a confirmation screen Telegram draws itself. It asks for the
 * `@username` and nothing else: that is the one field with a rule worth
 * catching early and the one that can already be taken, while the display name
 * is asked for on Telegram's own screen a second later — asking here too would
 * be the same question twice on two consecutive screens.
 *
 * Nothing here creates anything: the bot is born on Telegram's side and
 * arrives through the manager bot's webhook, which is why the second half ends
 * in waiting rather than in a response. See `apps/bots/managed.py`.
 */
export function NewBotForm({
  project,
  projects = [],
  managed,
}: {
  project?: { id: string; name: string };
  /** Every project in the workspace — only sent when the query named none. */
  projects?: { id: string; name: string }[];
  managed: ManagedBotConfig;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"connect" | "create">("connect");
  /*
   * Where the bot lands, when the page was not told.
   *
   * Defaulted to the first project rather than left empty: the form has to name
   * a destination before the reader presses anything, and "whichever the server
   * picks" is not a destination anybody can check. If there is exactly one
   * project the picker still shows it — one line that answers "where does this
   * go" costs less than the question.
   */
  const [chosenProjectId, setChosenProjectId] = useState(projects[0]?.id ?? "");
  const target = project ?? projects.find((item) => item.id === chosenProjectId);

  return (
    <div className="flex flex-col gap-4">
      {/* The header row: where this lands on the left, the way out on the
          right. An X rather than a "Bekor qilish" at the foot of the form —
          leaving is not the last step of filling it in, and a text button
          under the fields reads as one. */}
      <div className="flex items-center gap-2">
        {project ? (
          <p className="t-footnote t-secondary m-0 flex min-w-0 flex-1 items-center gap-1.5">
            <Icon name="folders" size={15} className="flex-none" />
            <span className="truncate">{project.name}</span>
          </p>
        ) : projects.length > 0 ? (
          // The same slot, doing the same job in the other direction. Opened
          // from a project this row states where the bot goes; opened from
          // "Botlar" it used to be a blank strip with a close button floating
          // in it, and the destination was never mentioned at all.
          <label className="t-footnote t-secondary m-0 flex min-w-0 flex-1 items-center gap-1.5">
            <Icon name="folders" size={15} className="flex-none" />
            <span className="sr-only">Loyiha</span>
            <Select
              value={chosenProjectId}
              onChange={(event) => setChosenProjectId(event.target.value)}
              className="h-8 min-w-0 flex-1 text-[13px]"
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          // Back where it was opened from. A form reached from a project used
          // to close onto the global bot list, which loses the one piece of
          // context the reader had — and reads as the X having navigated
          // somewhere rather than having dismissed something.
          onClick={() => router.push(project ? `/projects/${project.id}` : "/bots")}
          aria-label="Bekor qilish"
          title="Bekor qilish"
          className="oq-press flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      {/* A full plan is not a reason one of the two tabs is missing — it is the
          reason there is nothing on this screen to press. Both halves end in a
          `Bot` row and the plan will hold neither, so offering the token field
          would be the same broken promise one step further in: a form that
          takes a secret, spends a round trip and answers 402.

          The other three reasons only close the second tab, and pasting a
          token still works, so they stay where they were. */}
      {managed.reason === "plan_limit" ? (
        <Unavailable managed={managed} />
      ) : (
        <>
          <Segmented
            label="Bot qo'shish usuli"
            options={[
              { value: "connect", label: "Botni ulash" },
              { value: "create", label: "Botni yaratish" },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === "connect" ? (
            <ConnectHalf project={target} />
          ) : (
            <CreateHalf project={target} managed={managed} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The token half.
 *
 * The shape of the token is checked as it is typed, since that costs nothing
 * and catches a truncated paste before a round trip; whether it *works* is
 * Telegram's answer, and it lands under the same field.
 */
function ConnectHalf({ project }: { project?: { id: string; name: string } }) {
  const [state, formAction] = useActionState(connectBotAction, CONNECT_BOT_INITIAL_STATE);
  const [token, setToken] = useState("");
  const [touched, setTouched] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Blurring a field you never typed in is not a mistake worth a red sentence:
  // "Token kiritilishi shart." belongs to a submit, not to a reader who focused
  // the input and changed their mind.
  const localError = touched ? validateBotToken(token) : null;
  // The answer carries the token it is about, so editing the field clears a
  // stale message and nothing else can hide a fresh one.
  const serverError = state.status === "error" && state.token === token.trim() ? state.message : null;
  const error = localError ?? serverError;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      {/* Stated, not asked: the reader came here from that project, and the
          action checks the id again before it trusts it. */}
      {project && <input type="hidden" name="projectId" value={project.id} />}

      {/* The one (i) on this screen. Where the token comes from is a real
          question with a real answer, and it is the only sentence here that
          changes what the reader does next. */}
      <Field
        label="Bot tokeni"
        required
        error={error}
        info="@BotFather → /mybots → API Token. Bot nomi va @username tokendan avtomatik aniqlanadi."
      >
        <Input
          name="token"
          required
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="123456789:AAH…"
          className="font-mono"
          value={token}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => setToken(event.target.value)}
          onBlur={() => setTouched(token.trim().length > 0)}
        />
      </Field>

      <SubmitButton formRef={formRef} />
    </form>
  );
}

/**
 * The create half: two suggestions, a link, and then waiting.
 *
 * The waiting is not a detail to be tidied away — it is the shape of the
 * feature. Telegram will not tell us anything until the reader has confirmed a
 * screen on their own device, so the honest thing on ours is to say what we
 * are waiting for and keep the link reachable in case the tab was closed.
 */
function CreateHalf({
  project,
  managed,
}: {
  project?: { id: string; name: string };
  managed: ManagedBotConfig;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState<{ id: string; url: string } | null>(null);

  const open = useCallback(async () => {
    setError(null);
    setPending(true);
    const result = await openBotCreateRequestAction({
      projectId: project?.id ?? "",
      // Left to Telegram: its screen asks for the display name with the field
      // already focused, and a name sent from here would only pre-fill what
      // the reader is about to be asked for anyway.
      name: "",
      username,
    });
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setWaiting({ id: result.request.id, url: result.request.url });
    // A new tab, not this one: coming back to a page that is still waiting is
    // the whole point, and navigating away from it loses the poll.
    window.open(result.request.url, "_blank", "noopener");
  }, [project?.id, username]);

  // Ask, while the reader is away, until there is something to say — or until
  // it is clear nothing is going to be said.
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const status = await botCreateStatusAction(waiting.id);
      if (stopped) return;
      if (status.status === "ready" && status.bot) {
        clearInterval(timer);
        router.replace(`/bots/${status.bot.id}`);
        return;
      }
      if (status.status === "failed" || status.status === "expired") {
        clearInterval(timer);
        setWaiting(null);
        setError(
          status.message ??
            (status.status === "expired"
              ? "So'rov muddati tugadi — qaytadan urinib ko'ring."
              : "Botni yaratib bo'lmadi."),
        );
      }
    }, POLL_MS);
    const giveUp = setTimeout(() => {
      stopped = true;
      clearInterval(timer);
      setWaiting(null);
      setError("Telegramdan javob kelmadi. Oynani yopgan bo'lsangiz, qaytadan urinib ko'ring.");
    }, GIVE_UP_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [router, waiting]);

  if (!managed.enabled) {
    return <Unavailable managed={managed} />;
  }

  if (waiting) {
    return (
      <div className="flex flex-col gap-3">
        <p className="t-body m-0">Telegramda tasdiqlashni kutmoqdamiz…</p>
        <p className="t-footnote t-secondary m-0">
          Ochilgan oynada bot nomi va @username&apos;ini tekshiring va tasdiqlang. Bot yaratilgach bu sahifa
          o&apos;zi ochiladi.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={waiting.url}
            target="_blank"
            rel="noopener noreferrer"
            className="oq-press t-body flex min-h-[44px] items-center px-1 text-accent-400"
          >
            Oynani qayta ochish
          </a>
          {/* The other half of "keep the link reachable in case the tab was
              closed": a reader who changed their mind, or who closed Telegram
              without confirming, had nothing on this screen to press at all. */}
          <button
            type="button"
            onClick={() => setWaiting(null)}
            className="oq-press t-body flex min-h-[44px] cursor-pointer items-center px-1 text-neutral-400"
          >
            Bekor qilish
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Bot username'i" required error={error}>
        <Input
          autoFocus
          autoComplete="off"
          spellCheck={false}
          // Names the field rather than inventing a bot, and carries the rule
          // in its own shape: it ends in `bot`, which is the one thing about
          // this field a reader cannot guess.
          //
          // It was "savdo_bot" — an example, and a reasonable one, except that a
          // grey lowercase word inside an empty field reads as a value already
          // typed in at least as often as it reads as a suggestion. Paired with
          // a label that had just been translated to "Foydalanuvchi nomi", the
          // screen was asking for somebody's own username and showing a shop's
          // bot as the answer. This says the same thing without naming anybody's
          // business, and the sentence under the field states the rule outright
          // for when typing covers the placeholder up.
          placeholder="username_bot"
          className="font-mono"
          maxLength={32}
          value={username}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => setUsername(event.target.value.replace(/^@/, ""))}
        />
      </Field>
      {/* Telegram's rule, said before it is broken rather than after: it is the
          one thing about this field a reader cannot guess.

          The rule and nothing else. It used to end "— masalan shifo_bot", and
          an example under an empty field is read as something to type: the
          placeholder above had already been changed away from a plausible name
          for exactly that reason, and leaving one here put it back two lines
          down. */}
      <p className="t-footnote t-secondary m-0">Username &quot;bot&quot; bilan tugashi shart.</p>

      <MainButton
        text="Telegramda yaratish"
        loading={pending}
        disabled={username.trim().length < 5}
        inline
        onClick={() => void open()}
      />
    </div>
  );
}
