# Booking calendar: setup

Clients pick a time on your booking page. The meeting appears in AgencyOS (the **Calendar** page, the lead, Tasks and the Inbox) and, once you
connect it, in your Google Calendar with a Google Meet link. It works like a GoHighLevel personal calendar:
- weekly hours
- meeting length
- slot interval
- buffers
- minimum notice
- booking window
- daily cap
- your Google busy times block slots

## 1. Run the migration (2 minutes)
1. In Supabase, open the **SQL Editor** and click **New query**.
2. Paste in everything from `supabase/migrations/0016_booking_calendar.sql`.
3. Click **Run**. It is safe to run it again.

## 2. Allow Google Calendar in Google Cloud (5 minutes, once)
Use the same Google Cloud project as the Gmail connection.
1. Go to **APIs & Services → Library**, search for **Google Calendar API** and click **Enable**.
2. Go to **APIs & Services → OAuth consent screen → Data access** (or **Scopes**) and click **Add or remove scopes**.
3. Tick these two scopes, then click **Update** and **Save**:
   - `.../auth/calendar.events`
   - `.../auth/calendar.freebusy`
4. While the app is in **Testing**, your and Abdullah's Google accounts must be listed under **Audience → Test users**. The Gmail connection needs the same.

You don't need a new redirect URL. The calendar comes back through the Gmail one (`/auth/gmail/callback`).

## 3. Connect your Google Calendars (each of you, 1 minute)
1. In AgencyOS, open **Calendar** and click **Connect Google Calendar**.
2. Choose your Google account and tick every box.
3. You can turn two options on or off:
   - **Block slots when I'm busy:** anything marked busy in your Google Calendar can't be booked.
   - **Add bookings to my Google Calendar:** each booking becomes an event with a Meet link, and Google emails the client an invite.

## 4. Make your booking page
1. On the **Calendar** page, click **New booking calendar**. Then set:
   - your weekly hours and **time zone**
   - meeting length, buffers, minimum notice, and how far ahead people can book
   - whether the meeting is on Google Meet or by phone
2. Click **Save calendar**, then **Open booking page** to try it.
3. Back on the **Calendar** page you can:
   - **Copy link:** send it in emails or WhatsApp.
   - **Website code:** paste it into thesentinelsystems.com. The page sits inside your site and resizes itself.
   - **Use as team booking link** (owner): the "Book a free consultation" button in marketing emails and the suggested replies use it.

## What happens when someone books
- **Lead:** a lead is created (or the existing one found by email) and moved to **Meeting booked**. The contact gets *express* consent.
- **Your Google Calendar** gets the event with a Meet link, and the client gets Google's invite.
- **In AgencyOS:**
  - a pinned note with their answers
  - a task "Meeting with …" at the meeting time
  - an Inbox item
  - the meeting on the **Calendar** page
- **Cancelling:** the client can cancel from the link on their confirmation. You can cancel on the Calendar page. Either way, Google tells the other side.
