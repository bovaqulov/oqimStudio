"use client";

/**
 * A script that runs while the browser is still parsing the document.
 *
 * Nothing else in the stack is early enough. `useEffect` runs after the paint,
 * `useLayoutEffect` after hydration, and `next/script` is later than either: in
 * the app router even `beforeInteractive` only emits a stub that pushes the
 * body onto `self.__next_s`, and Next's own loader appends it once the runtime
 * bundle has run. All three land after the reader has already seen the screen
 * these callers exist to correct. A `<script>` sitting in the served HTML is
 * the only one the parser executes on its way past, before the first paint.
 *
 * The `type` is the whole trick. React builds the head's children again on the
 * client — on hydration, and again on the remount Strict Mode does under
 * `next dev` — and a script created by `document.createElement` never runs, so
 * React reports "Encountered a script tag while rendering React component"
 * rather than quietly doing nothing. Any type it does not recognise as
 * JavaScript is a data block: React stops warning and the browser stops
 * reading. The server keeps emitting `text/javascript`, which is the copy that
 * matters, because it is the one the parser reaches;
 * `suppressHydrationWarning` covers the difference between the two on the way
 * through.
 *
 * Re-running on the client would be wrong in any case. By then the attribute is
 * set and React is mid-flight over it; every caller here is racing a paint that
 * has already happened.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
