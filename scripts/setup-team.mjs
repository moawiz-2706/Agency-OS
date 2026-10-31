// Create Supabase Auth users for the team and their team_members rows.
// The first email in TEAM_EMAILS is the owner, the rest are partners.
// Safe to re-run: existing users and members are updated, not duplicated.
//
//   TEAM_EMAILS=you@agency.com,partner@agency.com
//   TEAM_NAMES=Moawiz,Partner          (optional, same order)
//
// Usage: node scripts/setup-team.mjs
import { admin, env, must } from "./lib.mjs";

const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed"];

const emails = env("TEAM_EMAILS").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const names = (process.env.TEAM_NAMES ?? "").split(",").map((n) => n.trim());
const db = admin();

// Find existing auth users by email (the admin API lists, it doesn't search).
const users = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  for (const u of data.users) if (u.email) users.set(u.email.toLowerCase(), u);
  if (data.users.length < 1000) break;
}

for (const [i, email] of emails.entries()) {
  let user = users.get(email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw new Error(`${email}: ${error.message}`);
    user = data.user;
    console.log(`created auth user  ${email}`);
  } else {
    console.log(`auth user exists   ${email}`);
  }

  const row = {
    user_id: user.id,
    email,
    full_name: names[i] || email.split("@")[0],
    role: i === 0 ? "owner" : "partner",
    color: COLORS[i % COLORS.length],
    active: true,
  };
  const existing = must(await db.from("team_members").select("id,full_name").ilike("email", email).limit(1));
  if (existing.length) {
    if (!names[i]) delete row.full_name;   // keep a name set in the app
    must(await db.from("team_members").update(row).eq("id", existing[0].id));
    console.log(`  team member updated (${row.role})`);
  } else {
    must(await db.from("team_members").insert(row));
    console.log(`  team member added (${row.role})`);
  }
}

console.log(`\nDone: ${emails.length} team member(s). They sign in at /login with a magic link.`);
