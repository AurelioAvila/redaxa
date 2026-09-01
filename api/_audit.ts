/**
 * The audit export: the pieces of it that are pure functions.
 *
 * Separate from scan.ts so they can be tested without a live Supabase and
 * without the environment scan.ts pulls in through _billing.ts. The leading
 * underscore keeps this a helper module rather than a route — the project
 * sits at Vercel's twelve-function cap, which is also why the audit endpoints
 * are folded into scan.ts rather than given a file of their own.
 */

/**
 * The most rows one request will read.
 *
 * There is a cap because a serverless function has a fixed memory and time
 * budget, and an organization that has been running for a year is not a page
 * of results. The number that matters is not this one, though — it is that
 * the caller is *told* when it was hit. See `truncated` below.
 */
export const maxAuditRows = 5000;

/** What the dashboard shows without asking for a range. */
export const defaultAuditRows = 200;

/**
 * Parses a caller-supplied day into an ISO instant, or null.
 *
 * Re-serialising through `Date` rather than pattern-matching the string is
 * what makes this safe to interpolate into a PostgREST filter: whatever
 * arrives, what leaves is an ISO timestamp this function produced.
 */
export function auditBoundary(value: unknown, endOfDay: boolean): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(endOfDay ? `${value.trim()}T23:59:59.999Z` : `${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    const loose = new Date(value.trim());
    return Number.isNaN(loose.getTime()) ? null : loose.toISOString();
  }
  return parsed.toISOString();
}


export type AuditEvent = {
  created_at: string;
  application: string;
  finding_kinds: string[] | null;
  finding_categories: string[] | null;
  finding_count: number;
  action: string;
  user_id: string;
};

/** RFC 4180: quote everything, double the quotes inside. */
export function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The audit export.
 *
 * A leading note row, not just column headers. This file is handed to
 * auditors and to whoever is answering a GDPR or AI Act question, and the
 * two things they need to know before reading a single row are what the
 * record covers and what it deliberately does not contain. A CSV that opens
 * straight into data invites both questions to be answered by assumption.
 */
export function auditCsv(events: AuditEvent[], emailById: Map<string, string | null>, scope: string, from: string | null, to: string | null, truncated: boolean): string {
  const range = from || to
    ? `${from ? from.slice(0, 10) : "the beginning"} to ${to ? to.slice(0, 10) : "now"}`
    : "all recorded activity";
  const notes = [
    `# Redaxa audit export — ${scope === "org" ? "organization" : "account"} — ${range}`,
    `# Generated ${new Date().toISOString()}. ${events.length} event(s).`,
    "# Metadata only: this record contains no prompt text and no detected values, by design.",
  ];
  if (truncated) {
    notes.push(`# INCOMPLETE: the ${maxAuditRows}-row limit was reached. Narrow the date range to export the rest.`);
  }
  const header = "created_at,member,application,action,finding_count,finding_kinds,finding_categories";
  const rows = events.map((event) => [
    event.created_at,
    emailById.get(event.user_id) ?? "",
    event.application,
    event.action,
    String(event.finding_count),
    (event.finding_kinds ?? []).join("|"),
    (event.finding_categories ?? []).join("|"),
  ].map(csvCell).join(","));
  return `${notes.join("\n")}\n${header}\n${rows.join("\n")}\n`;
}
