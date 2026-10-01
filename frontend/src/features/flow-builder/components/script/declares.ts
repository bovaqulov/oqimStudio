/**
 * Whether the text on screen declares a given function.
 *
 * `apps/engine/expressions.py::DECLARATION_PATTERN` ported name by name: the
 * two shapes an author writes a top-level declaration in, anchored to the start
 * of a line so a function nested inside another one is not offered as a hook
 * the runtime can reach.
 *
 * Asked of the *source* rather than read off `FlowScriptHook.declared`, which
 * is only ever as fresh as the last save. Two parts of the panel need the
 * answer — the run drawer's hook picker and the rail's «faylda bor» mark — and
 * they were reading different things: one tracked the draft, the other the last
 * saved file, so the rail told an author a hook they had just typed was not
 * there while the drawer was already running it. One reader, one answer.
 *
 * `$` is the one character a JavaScript identifier may hold that a regular
 * expression reads as punctuation.
 */
export function declaresHook(source: string, name: string): boolean {
  const safe = name.replace(/\$/g, "\\$");
  return new RegExp(
    `^[ \\t]*(?:async[ \\t]+)?function[ \\t]+${safe}(?![A-Za-z0-9_$])` +
      `|^[ \\t]*(?:const|let|var)[ \\t]+${safe}[ \\t]*=`,
    "m",
  ).test(source);
}
