import { NextResponse } from "next/server";
import { flowTransferRepository } from "@/features/flows/data/transfer-repository";
import { getSession } from "@/features/workspace/session";
import { ApiError } from "@/lib/api/server";

/**
 * Hands one flow over as a `.json` file.
 *
 * A route of our own rather than a link straight at Django, for the reason the
 * contact export has one: the credential is an httpOnly cookie for *this*
 * origin, so the browser cannot authenticate against the backend itself. The
 * tenant comes from the session and never from the request, so a flow id
 * guessed from another workspace answers 404 rather than a file.
 *
 * The JSON is re-serialised on the way through instead of streamed. This file
 * is meant to be read — pasted into another model as the worked example, and
 * skimmed by the author to see what the schema looks like — and one long line
 * is neither.
 */

/**
 * A filename a browser and a filesystem will both take.
 *
 * ASCII only: a non-ASCII `filename=` in Content-Disposition is decoded
 * differently by every client, and a flow called "Buyurtma qabuli" downloading
 * as mojibake is worse than one downloading as `buyurtma-qabuli.json`. A name
 * with nothing ASCII left in it falls back rather than producing `.json` with
 * no stem.
 */
function fileName(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${stem || "oqim"}.json`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ flowId: string }> },
): Promise<Response> {
  // Outside the try on purpose: an expired credential makes `getSession`
  // redirect by throwing, and a catch around it would turn the sign-out into a
  // 500 with a sentence about the flow.
  const { workspace } = await getSession();
  const { flowId } = await params;

  try {
    const flow = await flowTransferRepository.exportFlow(workspace.id, flowId);
    return new Response(`${JSON.stringify(flow, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName(flow.name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("flow export failed", error);
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : "Oqimni yuklab bo'lmadi.";
    return NextResponse.json({ error: message }, { status });
  }
}
