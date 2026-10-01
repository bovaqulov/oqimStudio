import { NextResponse } from "next/server";
import { API_BASE_URL, readAuthToken, WORKSPACE_COOKIE } from "@/lib/api/server";
import { cookies } from "next/headers";

/**
 * Streams the contact export from the backend to the browser.
 *
 * A proxy rather than a direct link: the credential is an httpOnly cookie for
 * *this* origin, so the browser cannot authenticate against Django itself. The
 * file is handed over with its own headers intact, so the download behaves like
 * one and Excel gets the encoding it needs.
 */
export async function GET(request: Request): Promise<Response> {
  const token = await readAuthToken();
  if (!token) return NextResponse.json({ error: "auth" }, { status: 401 });

  const store = await cookies();
  const search = new URL(request.url).search;
  const upstream = await fetch(`${API_BASE_URL}/api/contacts/export/${search}`, {
    headers: {
      Authorization: `Token ${token}`,
      "X-Workspace-Id": store.get(WORKSPACE_COOKIE)?.value ?? "",
    },
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: "export failed" }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "Content-Disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="kontaktlar.csv"',
      "Cache-Control": "no-store",
    },
  });
}
