// Ready-made outreach sequences (the Templates page). Each one becomes a normal
// sequence (campaign + templates) you can edit before adding leads. Written to the
// rules that get cold emails read and answered: a short, lower-case subject that looks
// like a normal email; the first line about THEM ({{personal_line}}, the research hook);
// one problem, one idea, one easy question; no links or images (the website sits in the
// signature); follow-ups short, in the same thread, each adding something new; a polite
// last email. No app imports, so `node --test` can load it directly.

import type { Step } from "./sequences.ts";

export type LibrarySequence = { key: string; name: string; offer: string; bestFor: string; steps: Step[] };

export const EMAIL_RULES = [
  "Subject: 2 to 5 words, lower case, like an email from a colleague (\"missed calls at {{company}}\"). No \"free\", \"offer\" or \"!\".",
  "First line is about them: the research hook ({{personal_line}}). It's left out cleanly when a lead has none.",
  "50 to 120 words, one idea, one question. Short emails are read on a phone between jobs.",
  "Ask for interest, not a meeting: \"Worth a quick look?\" gets more replies than \"Book a 30-minute call\".",
  "No links or images in the first email; they push cold email towards spam. Your website is in the signature.",
  "Follow-ups go in the same thread, 3 to 6 days apart, and each adds one new idea. The last one closes politely.",
];

const S = (day: number, subject: string, body: string): Step => ({ day, subject, body });

export const LIBRARY: LibrarySequence[] = [
  {
    key: "missed_call", name: "Missed calls → text-back", offer: "missed_call_textback",
    bestFor: "HVAC, plumbing, electrical: anyone who misses calls while on a job",
    steps: [
      S(1, "missed calls at {{company}}",
        "Hi {{first_name}},\n\n{{personal_line}}\n\nQuick question: when your team is on a job and the phone rings, what happens to that call?\n\n"
        + "For most {{trade}} companies we talk to, it goes to voicemail and the homeowner rings the next company on Google. "
        + "We set up a text that goes out automatically within seconds (\"Sorry we missed you, this is {{company}}. How can we help?\"), so the customer stays with you.\n\n"
        + "Worth a quick look?"),
      S(4, "",
        "Hi {{first_name}}, a quick follow-up.\n\nTo picture it: a homeowner calls, nobody can pick up, and 30 seconds later they get a text from {{company}}. "
        + "They reply, and you see the whole conversation on your phone when you're free, instead of a voicemail you have to chase.\n\n"
        + "Would that help on your busiest days?"),
      S(8, "",
        "Hi {{first_name}},\n\nOne idea that pairs with this: when someone texts back after hours, an assistant can ask what they need and the address, "
        + "so your first call the next morning is already half done.\n\nIf it's easier, I can record a 2-minute video showing how it would work for {{company}}. Want me to send it?"),
      S(14, "",
        "Hi {{first_name}}, I'll close the loop here.\n\nIf missed calls aren't a problem for {{company}} right now, no worries at all. "
        + "If that changes, just reply to this email and I'll pick it up from there."),
    ],
  },
  {
    key: "online_booking", name: "Online booking", offer: "online_booking",
    bestFor: "Businesses where customers can only call or fill in a contact form",
    steps: [
      S(1, "booking at {{company}}",
        "Hi {{first_name}},\n\n{{personal_line}}\n\nI noticed customers can call or send a form, but there's no way to pick a time themselves. "
        + "A lot of homeowners browse in the evening, and by the time you call back the next day, some have already booked someone else.\n\n"
        + "We add a simple booking calendar to your site: they choose a slot you've opened, get a confirmation text and a reminder the day before.\n\n"
        + "Would that be useful for {{company}}?"),
      S(4, "",
        "Hi {{first_name}}, following up on this.\n\nYou stay in control: you decide which jobs can be booked online (estimates, tune-ups) and which times are open. "
        + "Everything lands in your calendar, and the reminder texts cut down on no-shows.\n\nWorth a look?"),
      S(9, "",
        "Hi {{first_name}},\n\nHappy to make this concrete: I can send a short video of what the booking page and texts would look like with {{company}}'s name on them. "
        + "No cost, no obligation.\n\nWant me to put it together?"),
      S(15, "",
        "Hi {{first_name}}, last note from me.\n\nIf online booking isn't a priority right now, no problem. "
        + "If it becomes one, just reply here and I'll pick it up."),
    ],
  },
  {
    key: "speed_to_lead", name: "Instant reply to new leads", offer: "speed_to_lead",
    bestFor: "Businesses running Google, Local Services or Facebook ads",
    steps: [
      S(1, "your new leads",
        "Hi {{first_name}},\n\n{{personal_line}}\n\nWhen someone fills in your form or clicks your ad, how quickly do they hear back?\n\n"
        + "Homeowners usually contact two or three companies, and the first to reply tends to get the job. "
        + "We set things up so every new lead gets a text from {{company}} within seconds, and you get an alert at the same time.\n\n"
        + "Is speed of reply something you think about?"),
      S(4, "",
        "Hi {{first_name}}, a quick follow-up.\n\nThe text can ask one useful question (\"What's the address and what's going on?\"), "
        + "so when you call, you already know the job. If they don't answer, it follows up on its own the next day.\n\nWould that help with the leads you're paying for?"),
      S(8, "",
        "Hi {{first_name}},\n\nOne more thing it gives you: a simple view of which ads bring in jobs, not just leads. "
        + "That makes it much easier to decide where the ad money goes.\n\nHappy to show you in 15 minutes if it's useful."),
      S(14, "",
        "Hi {{first_name}}, I'll leave it here.\n\nIf lead follow-up is already covered at {{company}}, great. If not, just reply and I'll pick it up."),
    ],
  },
  {
    key: "reviews", name: "More Google reviews", offer: "review_automation",
    bestFor: "Good businesses with fewer than about 50 Google reviews",
    steps: [
      S(1, "{{company}} reviews",
        "Hi {{first_name}},\n\n{{personal_line}}\n\nWhen people search for {{trade}} in {{city}}, the companies with the most recent reviews tend to get the calls, "
        + "even when their work is no better than yours.\n\nWe set up a text that goes to each customer when a job is done, with a one-tap link to leave a Google review. "
        + "Nobody has to remember to ask.\n\nWould more reviews help {{company}} right now?"),
      S(4, "",
        "Hi {{first_name}}, following up.\n\nIt can also catch problems early: a customer who isn't happy gets a message to you first, so you can fix it before it turns into a public review.\n\nWorth a look?"),
      S(9, "",
        "Hi {{first_name}},\n\nI can send you a short example of the text and review page with {{company}}'s name on it, so you can see exactly what customers would get.\n\nWant me to send it?"),
      S(15, "",
        "Hi {{first_name}}, last note from me.\n\nIf reviews aren't a focus right now, no worries. If that changes, just reply and I'll pick it up."),
    ],
  },
  {
    key: "ghl", name: "GoHighLevel tune-up", offer: "ghl_optimisation",
    bestFor: "Businesses whose site already runs on GoHighLevel / LeadConnector",
    steps: [
      S(1, "your gohighlevel setup",
        "Hi {{first_name}},\n\n{{personal_line}}\n\nI noticed {{company}} already uses GoHighLevel. Most accounts we look at only use a small part of it: "
        + "the forms work, but missed-call text-back, follow-ups and review requests are switched off or half set up.\n\n"
        + "We specialise in GoHighLevel for home-service businesses. I'm happy to do a free check of your setup and send you what I'd fix.\n\nWould that be useful?"),
      S(4, "",
        "Hi {{first_name}}, a quick follow-up.\n\nThe three things that usually make the biggest difference:\n- an instant text to every missed call and new form\n"
        + "- automatic follow-ups on estimates that haven't said yes\n- a review request after every finished job\n\nAll of them run on the account you already pay for. Want me to check which ones you have on?"),
      S(8, "",
        "Hi {{first_name}},\n\nIf it's easier, I can record a short video walking through what I'd change in {{company}}'s account, so you can decide without a call.\n\nShall I?"),
      S(14, "",
        "Hi {{first_name}}, I'll close the loop here.\n\nIf your GoHighLevel setup is already doing what you need, great. If you'd like a second pair of eyes at any point, just reply."),
    ],
  },
  {
    key: "website", name: "Website + Google profile", offer: "website_gbp",
    bestFor: "Businesses with no website, a broken one or an outdated one",
    steps: [
      S(1, "{{company}} website",
        "Hi {{first_name}},\n\n{{personal_line}}\n\nI had a look at how {{company}} shows up online, and I think you're losing some customers before they ever call. "
        + "Homeowners decide in seconds, mostly on their phone, and a site that's slow or hard to use sends them to the next result.\n\n"
        + "We build simple, fast sites for {{trade}} companies, connected to your Google profile, with a button to call, text or book.\n\nWould a quick look at what we'd change be useful?"),
      S(4, "",
        "Hi {{first_name}}, following up.\n\nTo keep it practical: I can send you three specific things I'd fix on your current site and Google profile, free. Use them with us or with anyone else.\n\nWant the list?"),
      S(9, "",
        "Hi {{first_name}},\n\nOne more point: your Google profile often gets more views than your website. Up-to-date photos, services and hours there bring in calls on their own.\n\nHappy to include that in the list. Interested?"),
      S(15, "",
        "Hi {{first_name}}, last note from me.\n\nIf the website isn't a priority right now, no problem. If it becomes one, just reply and I'll pick it up."),
    ],
  },
];

/** A sample lead for previews. */
export const SAMPLE_LEAD = {
  first_name: "Mike", full_name: "Mike Torres", company: "Torres Plumbing", city: "Tampa", trade: "plumbing",
  website: "torresplumbing.com",
  personal_line: "Saw on your site that you offer 24/7 emergency plumbing across Tampa, and that the only way to reach you is by phone.",
};
