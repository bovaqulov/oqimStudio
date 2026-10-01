/*
 * What a flow's script may *do* — the vocabulary, and the reason none of it
 * happens here.
 *
 * A hook could already compute (`engine/hooks.py`): it is handed a `ctx`, it
 * returns an object, and the runtime writes that object into the run's
 * variables. What it could not do was act — send a message, jump to a block,
 * set a tag, arm a reminder — because acting means a socket and a database,
 * and the sandbox around this file was built to have neither. All six
 * boundaries in `sandbox.py` are boundaries somebody else enforces, and every
 * one of them would have had to be opened to let `bot.send()` send.
 *
 * So it does not send. `bot.send()` appends one entry to a list, and the host
 * executes that list only once the script has returned without throwing. Four
 * things fall out of that single decision, and they are the whole design:
 *
 *   - the sandbox keeps its six boundaries: no network, no database, no
 *     Telegram token anywhere the author's code can reach;
 *   - a script that dies halfway leaves no half-done work. The list is
 *     discarded with the process, so a `throw` after three `bot.send()` calls
 *     sends nothing rather than three quarters of a conversation;
 *   - every action is journalled on the way out, by the one function in the
 *     runtime that already writes the trace;
 *   - a test needs no mocks. What the script did *is* a JSON array, and
 *     asserting on it is asserting on the thing itself.
 *
 * `http` and `store` are the one part that cannot be a list. An author writing
 * `const n = await store.incr("navbat")` needs the number *while the script is
 * still running*, and no amount of deferring produces it. They reach the host
 * by stopping instead: an unanswered call registers what it wants, returns a
 * promise that never settles, and the whole run halts at the end of the
 * current microtask drain with a list of what it asked for. The host performs
 * those, and runs the script **again** with the answers in hand — where each
 * one now resolves from the ledger instead of asking a second time.
 *
 * Replay is safe for exactly the reason above: a script that has not finished
 * has done nothing. Its command list is thrown away with the round, so the
 * only things that survive a round are the answers the host wrote down — and
 * `store.incr`, the one call in the vocabulary that must never happen twice,
 * is keyed by its position in the run and replayed from that ledger rather
 * than performed again.
 *
 * This module installs itself on `globalThis` and is otherwise inert: it opens
 * no socket, imports nothing, and reads nothing about the machine. It is a
 * vocabulary and a bookkeeper.
 */

//: The eight names a script can be granted. `studio` is listed and unwired —
//: it is the panel's own surface and nothing in the runtime answers it yet, so
//: it exists here only so that granting it is not a typo the author has to
//: discover from a scope error naming a scope that does not exist.
const SCOPE_NAMES = ["flow", "bot", "user", "queue", "team", "http", "store", "studio"];

//: What a script may spend when the host names no number. The host always
//: names them (they are Django settings), so these are the answer to a
//: malformed request and not a second copy of the policy.
const FALLBACK_LIMITS = {
  commands: 40,
  messages: 5,
  requests: 3,
  reminders: 5,
  store: 20,
};

//: Telegram's own ceiling on `sendChatAction`'s usefulness, and the clamp the
//: design names. Below one is not a wait; above ten is a webhook held open.
const TYPING_MIN = 1;
const TYPING_MAX = 10;

//: The three languages the product speaks (`apps/common/i18n.py`). Refused
//: here as well as there because the author reads this error and not that one.
const LANGUAGES = ["uz", "ru", "en"];

//: What `team.notify` may be marked as.
const LEVELS = ["info", "warning", "urgent"];

//: The bounds an outbound request's own timeout is held between. A script that
//: asks for 30 seconds is asking for a webhook Telegram has already given up
//: on; one that asks for 5 ms is asking for a failure it will then branch on.
const TIMEOUT_MIN = 500;
const TIMEOUT_MAX = 10000;

/*
 * The marker the runner races the author's code against.
 *
 * Its own object rather than a string or a symbol, because the value it stands
 * against is whatever the author returned — and an author who returns the
 * string "halt" must not be read as having halted.
 */
const HALTED = { halted: true };

function oqimRun(config, body) {
  const session = open(config || {});
  install(session);

  let halt;
  const stopped = new Promise((resolve) => {
    halt = resolve;
  });
  session.halt = () => halt(HALTED);

  // `Promise.resolve().then(body)` and not `body()`: a hook that throws
  // synchronously has to reject the race rather than throw past it, or the
  // whole shape below only holds for the async half of the vocabulary.
  return Promise.race([Promise.resolve().then(body), stopped]).then((value) => {
    if (value === HALTED) {
      // Nothing the script did this round survives. The command list is
      // discarded on purpose — the next round re-runs the same code and
      // rebuilds it — which is what makes replay free of half-done work.
      return { __oqim: 1, halted: true, pending: session.pending, commands: [] };
    }
    return {
      __oqim: 1,
      halted: false,
      // `undefined` is not JSON; the host would encode it as nothing at all
      // and `hooks.writable` would then be asked to read a hole.
      value: value === undefined ? null : value,
      commands: session.commands,
    };
  });
}

/** One run's bookkeeping — what has been asked for, and what is left to spend. */
function open(config) {
  const limits = Object.assign({}, FALLBACK_LIMITS, config.limits || {});
  const granted = new Set(
    (Array.isArray(config.scopes) ? config.scopes : []).filter((name) => SCOPE_NAMES.includes(name)),
  );
  return {
    scopes: granted,
    limits,
    // What the host already answered, keyed by the position of the call in
    // this run. Position and not a hash of the arguments: two identical
    // `store.incr("navbat")` calls are two different numbers, and a hash would
    // hand the second one the first one's answer.
    answers: config.answers || {},
    served: 0,
    pending: [],
    commands: [],
    // What this script has written to the store this round, so that a `get`
    // after a `set` reads what the author just wrote without costing a round
    // to find out. Correct because the host applies the writes in this order
    // and after this script has finished.
    shadow: new Map(),
    counts: { messages: 0, requests: 0, reminders: 0, store: 0 },
    // Which `flow.*` call claimed the run's direction. One per run, and the
    // name of the first one is what the second one's refusal reports.
    routed: "",
    halting: false,
  };
}

function fail(message) {
  throw new Error(message);
}

function gate(session, scope) {
  if (!session.scopes.has(scope)) {
    fail(`«${scope}» ruxsati yo'q. Script panelida uni yoqing.`);
  }
}

/** Appends one command, or refuses because the list is already as long as it may be. */
function push(session, command) {
  if (session.commands.length >= session.limits.commands) {
    fail(`Skript juda ko'p amal so'radi — eng ko'pi ${session.limits.commands} ta.`);
  }
  session.commands.push(command);
}

function spend(session, counter, ceiling, message) {
  session.counts[counter] += 1;
  if (session.counts[counter] > ceiling) {
    fail(`${message} — eng ko'pi ${ceiling} ta.`);
  }
}

/*
 * One call that needs an answer from outside the sandbox.
 *
 * Answered from the ledger when the host has already performed it, and
 * otherwise registered and left hanging: the promise returned here never
 * settles, so this branch of the author's code stops at its `await` and the
 * run halts at the end of the drain. A rejection is a real rejection, so
 * `try { await http.get(…) } catch` reads the way an author expects it to.
 */
function ask(session, request) {
  const id = String(session.served);
  session.served += 1;

  const answered = session.answers[id];
  if (answered) {
    if (answered.ok) return Promise.resolve(answered.value);
    return Promise.reject(new Error(answered.error || "So'rov bajarilmadi."));
  }

  session.pending.push(Object.assign({ id }, request));
  if (!session.halting) {
    session.halting = true;
    // A macrotask, so every sibling of a `Promise.all` has already registered
    // its own request by the time this fires. That is the difference between
    // three parallel calls costing one round and costing three.
    setTimeout(() => session.halt(), 0);
  }
  return new Promise(() => {});
}

/** The `{buttons: […]}` an author passed, reduced to what the runtime draws. */
function buttons(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((button, index) => {
    if (typeof button === "string") {
      return { id: `s${index}`, label: button };
    }
    const item = button || {};
    return {
      id: text(item.id) || `s${index}`,
      label: text(item.label),
      kind: text(item.kind) || "callback",
      url: text(item.url),
    };
  });
}

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

/*
 * The namespaces, installed as globals.
 *
 * Globals rather than an argument, because the author's file is a set of
 * ordinary function declarations — `function onFlowStart(ctx) { … }` — and
 * threading a second parameter through every one of them would make the
 * vocabulary something the author has to remember to accept. A `const bot` of
 * their own shadows this, which is the correct outcome: their name wins in
 * their own file.
 */
function install(session) {
  const target = globalThis;

  target.flow = {
    goto(blockId) {
      gate(session, "flow");
      route(session, "flow.goto", { op: "flow.goto", blockId: text(blockId) });
    },
    call(flowId, blockId) {
      gate(session, "flow");
      route(session, "flow.call", { op: "flow.call", flowId: text(flowId), blockId: text(blockId) });
    },
    restart() {
      gate(session, "flow");
      route(session, "flow.restart", { op: "flow.restart" });
    },
    end() {
      gate(session, "flow");
      route(session, "flow.end", { op: "flow.end" });
    },
    stop() {
      gate(session, "flow");
      route(session, "flow.stop", { op: "flow.stop" });
    },
  };

  target.bot = {
    send(body, options) {
      gate(session, "bot");
      const opts = options || {};
      spend(session, "messages", session.limits.messages, "Skript juda ko'p xabar yubormoqchi");
      push(session, {
        op: "bot.send",
        text: text(body),
        buttons: buttons(opts.buttons),
        buttonMode: text(opts.buttonMode),
        parseMode: text(opts.parseMode),
        silent: Boolean(opts.silent),
      });
    },
    media(url, options) {
      gate(session, "bot");
      const opts = options || {};
      spend(session, "messages", session.limits.messages, "Skript juda ko'p xabar yubormoqchi");
      push(session, {
        op: "bot.media",
        url: text(url),
        kind: text(opts.kind) || "photo",
        caption: text(opts.caption),
        buttons: buttons(opts.buttons),
      });
    },
    edit(messageId, body, options) {
      gate(session, "bot");
      const opts = options || {};
      push(session, {
        op: "bot.edit",
        messageId: positive(messageId, 0),
        text: text(body),
        buttons: buttons(opts.buttons),
      });
    },
    remove(messageId) {
      gate(session, "bot");
      push(session, { op: "bot.remove", messageId: positive(messageId, 0) });
    },
    typing(seconds) {
      gate(session, "bot");
      push(session, { op: "bot.typing", seconds: clamp(positive(seconds, TYPING_MIN), TYPING_MIN, TYPING_MAX) });
    },
  };

  target.user = {
    set(name, value) {
      gate(session, "user");
      push(session, { op: "user.set", name: text(name), value: value === undefined ? null : value });
    },
    setMany(values) {
      gate(session, "user");
      // One command per key, and not one command carrying an object: every
      // ceiling in this file counts commands, and a single entry holding four
      // hundred keys would pass all of them.
      for (const name of Object.keys(values || {})) {
        target.user.set(name, values[name]);
      }
    },
    tag(name) {
      gate(session, "user");
      push(session, { op: "user.tag", name: text(name) });
    },
    untag(name) {
      gate(session, "user");
      push(session, { op: "user.untag", name: text(name) });
    },
    lang(code) {
      gate(session, "user");
      const wanted = text(code).toLowerCase();
      if (!LANGUAGES.includes(wanted)) {
        fail(`«${wanted}» tili yo'q — faqat ${LANGUAGES.join(", ")}.`);
      }
      push(session, { op: "user.lang", code: wanted });
    },
  };

  target.queue = {
    remind(minutes, body, options) {
      gate(session, "queue");
      const opts = options || {};
      spend(session, "reminders", session.limits.reminders, "Skript juda ko'p eslatma qo'ymoqchi");
      push(session, {
        op: "queue.remind",
        minutes: Math.max(0, Math.round(positive(minutes, 0))),
        text: text(body),
        key: text(opts.key),
        buttons: buttons(opts.buttons),
      });
    },
    at(when, body, options) {
      gate(session, "queue");
      const opts = options || {};
      spend(session, "reminders", session.limits.reminders, "Skript juda ko'p eslatma qo'ymoqchi");
      // A Date, a number of milliseconds, or an ISO string — whichever the
      // author had. Normalised to milliseconds here so the host has one shape
      // to parse and the author has three ways to write it.
      let at = when;
      if (at instanceof Date) at = at.getTime();
      push(session, {
        op: "queue.at",
        at: typeof at === "number" ? at : text(at),
        text: text(body),
        key: text(opts.key),
        buttons: buttons(opts.buttons),
      });
    },
    cancel(key) {
      gate(session, "queue");
      push(session, { op: "queue.cancel", key: text(key) });
    },
  };

  target.team = {
    notify(body, options) {
      gate(session, "team");
      const level = text((options || {}).level) || "info";
      push(session, {
        op: "team.notify",
        text: text(body),
        level: LEVELS.includes(level) ? level : "info",
      });
    },
    handoff(reason) {
      gate(session, "team");
      push(session, { op: "team.handoff", reason: text(reason) });
    },
  };

  target.http = {
    get(url, options) {
      return target.http.request("GET", url, options);
    },
    post(url, body, options) {
      return target.http.request("POST", url, Object.assign({}, options || {}, { body }));
    },
    request(method, url, options) {
      gate(session, "http");
      const opts = options || {};
      try {
        spend(session, "requests", session.limits.requests, "Skript juda ko'p tashqi so'rov yubormoqchi");
      } catch (error) {
        // Rejected rather than thrown, so a ceiling reached inside a
        // `Promise.all` behaves like every other failure of an awaited call
        // and can be caught at the `await` the author wrote.
        return Promise.reject(error);
      }
      return ask(session, {
        kind: "http",
        method: text(method).toUpperCase() || "GET",
        url: text(url),
        body: opts.body === undefined ? null : opts.body,
        headers: opts.headers && typeof opts.headers === "object" ? opts.headers : {},
        timeout: clamp(positive(opts.timeout, TIMEOUT_MAX), TIMEOUT_MIN, TIMEOUT_MAX),
      });
    },
  };

  target.store = {
    get(key, fallback) {
      gate(session, "store");
      const name = text(key);
      // Read out of what this script has already written before asking the
      // host, so `set` then `get` costs no round at all — the host applies the
      // writes in this order once the script is done, so the shadow is not a
      // guess.
      if (session.shadow.has(name)) {
        const held = session.shadow.get(name);
        return Promise.resolve(held === undefined ? (fallback === undefined ? null : fallback) : held);
      }
      try {
        spend(session, "store", session.limits.store, "Skript juda ko'p saqlash amalini so'radi");
      } catch (error) {
        return Promise.reject(error);
      }
      return ask(session, { kind: "store", op: "get", key: name, fallback: fallback === undefined ? null : fallback });
    },
    set(key, value, ttl) {
      gate(session, "store");
      const name = text(key);
      // A write, so it is a *command*: nothing in the script needs an answer
      // to it, and making it an effect would cost a whole extra process launch
      // to be told "done".
      push(session, { op: "store.set", key: name, value: value === undefined ? null : value, ttl: positive(ttl, 0) });
      session.shadow.set(name, value === undefined ? null : value);
      return Promise.resolve(true);
    },
    remove(key) {
      gate(session, "store");
      const name = text(key);
      push(session, { op: "store.remove", key: name });
      // `undefined` in the shadow means "removed by this script" — distinct
      // from a key the shadow has never heard of, which still has to be asked
      // about.
      session.shadow.set(name, undefined);
      return Promise.resolve(true);
    },
    incr(key, by) {
      gate(session, "store");
      try {
        spend(session, "store", session.limits.store, "Skript juda ko'p saqlash amalini so'radi");
      } catch (error) {
        return Promise.reject(error);
      }
      // Never a command and never shadowed: the number only exists once the
      // host has produced it, and it is the one call in the vocabulary that
      // must happen exactly once however many rounds the run takes.
      return ask(session, { kind: "store", op: "incr", key: text(key), by: positive(by, 1) });
    },
  };
}

/*
 * A `flow.*` call, and the rule that there may be only one.
 *
 * Two of them is not a script asking for two things; it is a script whose
 * author believes the first one took effect immediately. Nothing here takes
 * effect immediately — that is the whole design — so the second call would
 * silently win, and a `flow.goto` inside an `if` that the author thought had
 * already left the function would send the conversation somewhere nobody drew.
 * Refused loudly, naming the call that already claimed the run.
 */
function route(session, name, command) {
  if (session.routed) {
    fail(`Oqim yo'nalishi allaqachon belgilangan (${session.routed})`);
  }
  session.routed = name;
  push(session, command);
}

/*
 * The whole of this module's public surface, and the reason it is a global
 * rather than an export.
 *
 * `host.mjs` will one day carry `import "./runtime.mjs";` and that single line
 * is all it needs: importing this file installs `__oqim`, and the driver
 * `hooks.py` appends under the author's code calls `globalThis.__oqim.run`.
 * Until that line exists the same text is folded into the composed body
 * instead — Node's permission model refuses the host a second file read, which
 * is written up in `hooks.RUNTIME_SOURCE`. Both routes end here, at the same
 * assignment, which is why there is one file and not two.
 */
globalThis.__oqim = { run: oqimRun, scopes: SCOPE_NAMES };
