# Website contact form → leads

Anyone who fills in the form on **thesentinelsystems.com** becomes a lead in the CRM:

- **New person:** a new lead at stage **Interested**, with source `web_form`.
- **Email or website already in the CRM:** the enquiry joins that existing lead, and the lead moves up to Interested.
- **Their answers:** saved as a pinned note on the lead.
- **Inbox:** a "Website enquiry" item appears on the **Inbox** page to handle.
- **Consent:** the contact is marked as having given consent ("express"), because they asked you to get in touch. Replying is fine in both the US and Canada.

Fields: Your name \*, Email \*, Company, Website, "Which tools do you use? (e.g. HubSpot, Xero, Jobber, Google Sheets)", "What's your biggest time-waster?".

## One-time setup

1. Merge the PR, then in **Supabase → SQL Editor**, paste `supabase/migrations/0011_web_form.sql` and click **Run**.
2. Nothing else is needed if the form sits on `https://thesentinelsystems.com` or `https://www.thesentinelsystems.com`.
   For other addresses, such as a Vercel preview link or a Lovable address, add them in
   **Vercel → AgencyOS project → Settings → Environment Variables**: name `FORM_ORIGINS`, value
   `https://thesentinelsystems.com,https://www.thesentinelsystems.com,https://your-preview.vercel.app`. Then redeploy.

## Option A: paste-in form (easiest, works anywhere)

Paste this where the form should appear (in Lovable: an "Embed / HTML" block, or ask Lovable to add it):

```html
<iframe id="sentinel-form" src="https://agencyos.thesentinelsystems.com/forms/contact"
        title="Contact us" style="width:100%;max-width:720px;height:640px;border:0;background:transparent" loading="lazy"></iframe>
<script>
  // Grows the frame to fit the form, so it never shows a scrollbar.
  window.addEventListener("message", function (e) {
    if (e.origin === "https://agencyos.thesentinelsystems.com" && e.data && e.data.type === "sentinel-form-height") {
      document.getElementById("sentinel-form").style.height = (e.data.height + 8) + "px";
    }
  });
</script>
```

To change the button text, add `?button=Book%20my%20free%20audit` to the `src` address.

## Option B: your own form, styled like your site

If your website (React/Next.js on Vercel) already has its own form, keep it and send it here when it's submitted.
The field names must be exactly: `name`, `email`, `company`, `website`, `tools`, `pain`.

```js
async function sendEnquiry(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const res = await fetch("https://agencyos.thesentinelsystems.com/api/forms/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, started: window.__formShownAt, page: location.href }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error);   // show body.error to the visitor
}
// When the form appears on screen:
window.__formShownAt = Date.now();
```

Two anti-spam rules for your own form:

- **Hidden trap field:** add a field named `company_url` and hide it from people, e.g. `<input name="company_url" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">`. Bots fill it in; people never see it.
- **Time stamp:** send `started`, the time the form appeared (milliseconds). Submissions faster than 3 seconds are treated as bots.

The answer is always JSON: `{ "ok": true }`, or `{ "ok": false, "error": "…" }` with a message you can show the visitor.

## Limits

At most 5 enquiries per visitor per hour and 200 a day in total. Bots get a fake "thanks" and nothing is saved.
