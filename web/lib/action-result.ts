/** `message` (optional) replaces the form's fixed success toast, e.g. "Sent to darin@…". */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
