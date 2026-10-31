export type WebsiteSignals = {
  reachable: boolean;
  https: boolean;
  mobile_viewport: boolean;
  has_form: boolean;
  has_online_booking: boolean;
  booking_tools: string[];
  has_chat_widget: boolean;
  chat_tools: string[];
  has_sms_cta: boolean;
  has_review_widget: boolean;
  has_ad_pixel: boolean;
  ad_pixels: string[];
  uses_ghl: boolean;          // already on GoHighLevel / LeadConnector
  emails_found: string[];     // published on their own site (CASL-relevant)
  title: string | null;
};

// ---------- signal detection ----------

const BOOKING: Record<string, RegExp> = {
  calendly: /calendly\.com/,
  housecall_pro: /housecallpro\.com/,
  servicetitan: /servicetitan/,
  jobber: /getjobber\.com|jobber\.com/,
  acuity: /acuityscheduling\.com/,
  setmore: /setmore\.com/,
  square_appointments: /squareup\.com\/appointments/,
  generic_cta: /book (?:online|now|a service|an appointment)|schedule (?:online|service|now)|request (?:an )?appointment/,
};

const CHAT: Record<string, RegExp> = {
  podium: /podium\.com/,
  birdeye: /birdeye\.com/,
  tawk: /tawk\.to/,
  intercom: /intercom(?:cdn)?\.(?:io|com)/,
  drift: /drift\.com|js\.driftt\.com/,
  livechat: /livechatinc\.com/,
  tidio: /tidio(?:chat)?\.co/,
  hubspot: /js\.hs-scripts\.com|js\.usemessages\.com/,
  crisp: /crisp\.chat/,
  zendesk: /zdassets\.com/,
  leadconnector_chat: /widgets\.leadconnectorhq\.com/,
};

const PIXELS: Record<string, RegExp> = {
  meta_pixel: /connect\.facebook\.net\/[^"']*fbevents|fbq\(/,
  google_ads: /googleadservices\.com|gtag\(\s*['"]config['"]\s*,\s*['"]aw-/,
  tiktok: /analytics\.tiktok\.com/,
  bing_ads: /bat\.bing\.com/,
};

const IGNORE_EMAIL = /\.(png|jpe?g|gif|svg|webp)$|example\.com|sentry|wixpress|domain\.com/;

export function detectSignals(html: string, finalUrl: string): WebsiteSignals {
  const h = html.toLowerCase();
  const hits = (m: Record<string, RegExp>) => Object.keys(m).filter((k) => m[k].test(h));
  const booking = hits(BOOKING);
  const chat = hits(CHAT);
  const pixels = hits(PIXELS);
  const emails = [
    ...new Set(
      (html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
        .map((e) => e.toLowerCase())
        .filter((e) => !IGNORE_EMAIL.test(e)),
    ),
  ].slice(0, 5);

  return {
    reachable: true,
    https: finalUrl.startsWith("https://"),
    mobile_viewport: /<meta[^>]+name=["']viewport["']/.test(h),
    has_form: /<form[\s>]/.test(h),
    has_online_booking: booking.length > 0,
    booking_tools: booking,
    has_chat_widget: chat.length > 0,
    chat_tools: chat,
    has_sms_cta: /href=["']sms:|text us/.test(h),
    has_review_widget: /birdeye|podium|nicejob|grade\.us|reviewsonmywebsite|elfsight/.test(h),
    has_ad_pixel: pixels.length > 0,
    ad_pixels: pixels,
    uses_ghl: /leadconnectorhq\.com|msgsndr\.com|gohighlevel/.test(h),
    emails_found: emails,
    title: html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]?.trim() ?? null,
  };
}
