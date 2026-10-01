import { NextResponse } from "next/server";
import { getSession } from "@/features/workspace/session";
import { API_BASE_URL, readAuthToken } from "@/lib/api/server";

/**
 * Streams the table's .xlsx from the backend to the browser.
 *
 * A route of our own rather than a link straight at Django, for the reason the
 * contact export has one: the credential is an httpOnly cookie for *this*
 * origin, so the browser cannot authenticate against the backend itself. The
 * tenant comes from the session and never from the request, so a table id
 * guessed from another workspace answers 404 rather than a file.
 *
 * The body is passed through untouched — it is a zip, and re-reading it here to
 * hand it on would buy nothing and cost the whole file in memory. The two
 * headers that make a download a download are taken from upstream, where the
 * filename was built beside the table that names it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tableId: string }> },
): Promise<Response> {
  // Outside any try: an expired credential makes `getSession` redirect by
  // throwing, and catching that would turn a sign-out into a 500.
  const { workspace } = await getSession();
  const { tableId } = await params;
  const token = await readAuthToken();
  if (!token) return NextResponse.json({ error: "auth" }, { status: 401 });

  const upstream = await fetch(
    `${API_BASE_URL}/api/tables/${encodeURIComponent(tableId)}/export/`,
    {
      headers: { Authorization: `Token ${token}`, "X-Workspace-Id": workspace.id },
      cache: "no-store",
    },
  );

  if (!upstream.ok) {
    // The backend's own sentence when it wrote one — "Jadval topilmadi" is a
    // better answer than "export failed", and it is already in Uzbek.
    const said = await upstream.text();
    let message = "Faylni yuklab bo'lmadi.";
    try {
      message = JSON.parse(said)?.error?.message || message;
    } catch {
      // A non-JSON body from a failing upstream is not worth reporting verbatim.
    }
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="jadval.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
