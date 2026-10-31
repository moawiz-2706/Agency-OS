#!/usr/bin/env node
import "./env.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CONSENT_BASES, NICHES, STARTER_CITIES, STATUSES,
  OFFERS, addContact, auditCompanies, findLeads, getLead, getResearchInput, importLeadsCsv, listLeads,
  listResearchQueue, pipelineSummary, researchReportSchema, saveResearchReport, suppress, updateLead, verifyEmails,
} from "@agencyos/core";

// IMPORTANT: stdio transport uses stdout for protocol messages.
// Log only with console.error.

// Tools here only parse input and call core. Business logic lives in @agencyos/core.

const server = new McpServer({ name: "agencyos", version: "0.2.0" });

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] });

/** Wrap a core call: JSON result on success, isError with a plain message on failure. */
const run = <A>(fn: (args: A) => Promise<unknown>) => async (args: A) => {
  try {
    return ok(await fn(args));
  } catch (e) {
    return fail(e);
  }
};

// ---------------------------------------------------------------
server.registerTool(
  "list_niches_and_markets",
  {
    title: "List niches and starter markets",
    description: "Show the niche presets and starter US/Canada cities AgencyOS is set up for.",
    inputSchema: {},
  },
  async () => ok({ niches: NICHES, starter_cities: STARTER_CITIES }),
);

// ---------------------------------------------------------------
server.registerTool(
  "find_leads",
  {
    title: "Find and save leads",
    description:
      "Search Google Places for businesses in a niche + city, save new ones to Supabase (deduped by Google place ID), " +
      "and give each a first score. Returns counts and the new leads only. Each call costs Google API credit.",
    inputSchema: {
      niche: z.string().describe(`Preset key (${Object.keys(NICHES).join(", ")}) or any free-text business type`),
      city: z.string().describe('e.g. "Dallas, TX" or "Toronto, ON"'),
      country: z.enum(["US", "CA"]),
      max_results: z.number().int().min(1).max(60).default(20),
    },
  },
  run(findLeads),
);

// ---------------------------------------------------------------
server.registerTool(
  "import_leads_csv",
  {
    title: "Import leads from CSV",
    description:
      "Import businesses and contacts from a CSV on this PC (bought lists, Maps exports, Apollo...). Columns are matched " +
      "by common header names. Companies are deduped by place ID, website domain and phone; contacts by email per company; " +
      "suppressed emails are skipped. US emails get a CAN-SPAM basis; Canadian emails stay unsendable unless the source URL " +
      "is on the business's own site. Run with dry_run first to check the column mapping and counts.",
    inputSchema: {
      file_path: z.string().optional().describe("Full path to the CSV, e.g. C:\\Users\\PC\\Downloads\\leads.csv"),
      csv_text: z.string().max(2_000_000).optional().describe("Or the CSV content itself, for small lists"),
      niche: z.string().optional().describe(`Set one niche for every row (${Object.keys(NICHES).join(", ")}); otherwise the file's category column is used`),
      default_country: z.enum(["US", "CA"]).optional().describe("For rows with no country and no recognisable state/province"),
      us_consent: z.enum(CONSENT_BASES).default("can_spam_b2b"),
      dry_run: z.boolean().default(false),
    },
  },
  run(importLeadsCsv),
);

// ---------------------------------------------------------------
server.registerTool(
  "audit_websites",
  {
    title: "Audit lead websites",
    description:
      "Fetch the homepage of leads not yet audited, detect booking/chat/ad-pixel/GHL signals and published emails, " +
      "store the audit and re-score. Pass company_ids for specific leads, or leave empty to process the next batch.",
    inputSchema: {
      company_ids: z.array(z.string().uuid()).optional(),
      limit: z.number().int().min(1).max(25).default(10),
      retry_failed: z.boolean().optional().describe("Re-check leads whose last audit failed (site down, timeout, lost connection)"),
    },
  },
  run(auditCompanies),
);

// ---------------------------------------------------------------
server.registerTool(
  "list_research_queue",
  {
    title: "Research queue",
    description: "Audited leads with no research report yet, highest score first, with their top recommended offer.",
    inputSchema: { limit: z.number().int().min(1).max(25).default(10) },
  },
  run(listResearchQueue),
);

// ---------------------------------------------------------------
server.registerTool(
  "get_research_input",
  {
    title: "Get research input",
    description:
      "Everything needed to research one lead: company facts, the latest website audit signals, recommended offers " +
      "(with reasons), contacts and the offer catalogue. Compact; no raw HTML.",
    inputSchema: { company_id: z.string().uuid() },
  },
  run(({ company_id }) => getResearchInput(company_id)),
);

// ---------------------------------------------------------------
server.registerTool(
  "save_research_report",
  {
    title: "Save research report",
    description:
      "Store a research report for one lead. Separate observed facts (seen, with URL) from inferred ones. EVERY gap " +
      "needs an evidence_url or the report is rejected. recommended_offer must be one of: " +
      `${Object.keys(OFFERS).join(", ")}. Moves the lead from new to researching.`,
    inputSchema: researchReportSchema.omit({ source: true, raw: true }).shape,
  },
  run((report) => saveResearchReport({ ...report, source: "claude" })),
);

// ---------------------------------------------------------------
server.registerTool(
  "list_leads",
  {
    title: "List leads",
    description: "List saved leads with filters, highest score first.",
    inputSchema: {
      status: z.enum(STATUSES).optional(),
      tier: z.enum(["high", "medium", "low"]).optional(),
      niche: z.string().optional(),
      city: z.string().optional().describe("Partial match, e.g. Dallas"),
      country: z.enum(["US", "CA"]).optional(),
      min_score: z.number().int().min(0).max(100).optional(),
      unaudited_only: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  run(listLeads),
);

// ---------------------------------------------------------------
server.registerTool(
  "get_lead",
  {
    title: "Get lead details",
    description: "Full record for one lead: company, score reasons, latest website audit, contacts and recent activity.",
    inputSchema: { company_id: z.string().uuid() },
  },
  run(({ company_id }) => getLead(company_id)),
);

// ---------------------------------------------------------------
server.registerTool(
  "update_lead",
  {
    title: "Update lead",
    description: "Change a lead's pipeline status and/or add a note. Every change is logged.",
    inputSchema: {
      company_id: z.string().uuid(),
      status: z.enum(STATUSES).optional(),
      note: z.string().max(2000).optional(),
    },
  },
  run(updateLead),
);

// ---------------------------------------------------------------
server.registerTool(
  "add_contact",
  {
    title: "Add contact",
    description:
      "Save a person/email for a lead. Always record where it was found (source_url). For Canadian leads, only use " +
      "casl_implied_published if the email is openly published on their site with no 'no unsolicited email' notice.",
    inputSchema: {
      company_id: z.string().uuid(),
      full_name: z.string().optional(),
      role: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      source_url: z.string().url(),
      email_published_publicly: z.boolean().default(false),
      consent_basis: z.enum(CONSENT_BASES).default("unknown"),
    },
  },
  run(addContact),
);

// ---------------------------------------------------------------
server.registerTool(
  "verify_email",
  {
    title: "Verify contact emails",
    description:
      "Check contacts' emails before outreach: syntax, mail server (MX) and suppression list. Stores valid / risky (role " +
      "address like info@) / invalid on each contact and says whether it can legally be emailed, and if not, why.",
    inputSchema: { contact_ids: z.array(z.string().uuid()).min(1).max(25) },
  },
  run(({ contact_ids }) => verifyEmails(contact_ids)),
);

// ---------------------------------------------------------------
server.registerTool(
  "suppress",
  {
    title: "Suppress email or domain",
    description: "Add an email or domain to the never-contact list (unsubscribe, bounce, asked not to contact).",
    inputSchema: {
      email: z.string().email().optional(),
      domain: z.string().optional(),
      reason: z.string(),
    },
  },
  run(suppress),
);

// ---------------------------------------------------------------
server.registerTool(
  "pipeline_summary",
  {
    title: "Pipeline summary",
    description: "Lead counts and average score per pipeline status, plus the last 5 searches.",
    inputSchema: {},
  },
  run(pipelineSummary),
);

// ---------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("AgencyOS MCP server running (stdio)");
