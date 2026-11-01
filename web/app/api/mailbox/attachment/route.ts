import { NextResponse, type NextRequest } from "next/server";
import { currentMember } from "@/lib/team";
import { myImapInboxes } from "@/lib/mail/worker";
import { FOLDERS, getAttachment, type Folder } from "@/lib/mail/mailbox";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Download one attachment from the caller's own inbox. Always sent as a download
 * (never shown on this site), so an HTML or SVG attachment can't run as our page.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const { member } = await currentMember();
  if (!member) return new NextResponse("Not signed in", { status: 401 });
  const inbox = (await myImapInboxes(member.id).catch(() => [])).find((i) => i.id === p.get("inbox"));
  const folder = p.get("folder") as Folder;
  const uid = Number(p.get("uid"));
  const index = Number(p.get("i"));
  if (!inbox || !FOLDERS.includes(folder) || !Number.isInteger(uid) || !Number.isInteger(index)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const a = await getAttachment(inbox.settings, folder, uid, index);
    const name = a.filename.replace(/[\r\n"\\]/g, "_");
    return new NextResponse(new Uint8Array(a.content), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Couldn't fetch the attachment", { status: 502 });
  }
}
