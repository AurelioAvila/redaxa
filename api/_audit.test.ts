import assert from "node:assert/strict";
import { auditBoundary, auditCsv, csvCell } from "./_audit.js";

// Dates arrive from a query string and end up inside a PostgREST filter.
// Re-serialising through Date is what makes that safe: whatever arrives, what
// leaves is an ISO timestamp this code produced.
{
  assert.equal(auditBoundary("2026-07-01", false), "2026-07-01T00:00:00.000Z");
  // The end of the range is the end of that day, not its first instant —
  // otherwise "to: today" silently excludes everything that happened today.
  assert.equal(auditBoundary("2026-09-30", true), "2026-09-30T23:59:59.999Z");
  assert.equal(auditBoundary("", false), null);
  assert.equal(auditBoundary(undefined, false), null);
  assert.equal(auditBoundary("not-a-date", false), null);
  assert.equal(auditBoundary(42, false), null);
}

{
  // The injection attempt that matters: PostgREST reads `&` and `=` as
  // structure, so a boundary that carried them through would let a caller
  // append their own filters to the query.
  const hostile = auditBoundary("2026-07-01&user_id=eq.someone-else", false);
  assert.ok(hostile === null || !hostile.includes("&"), `boundary leaked structure: ${hostile}`);
  assert.ok(hostile === null || !hostile.includes("="), `boundary leaked structure: ${hostile}`);
}

// RFC 4180. A member email or an application name is not attacker-chosen
// prose, but a stray quote still corrupts every column after it.
{
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
}

const event = {
  created_at: "2026-08-14T09:12:00.000Z",
  application: "chatgpt",
  finding_kinds: ["email", "api_key"],
  finding_categories: ["personal", "credentials"],
  finding_count: 2,
  action: "redact",
  user_id: "user-1",
};
const emails = new Map<string, string | null>([["user-1", "ada@example.com"]]);

{
  const csv = auditCsv([event], emails, "org", "2026-07-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z", false);

  // The two things a reader needs before the first data row: what the record
  // covers, and what it deliberately does not contain.
  assert.ok(csv.includes("# Redaxa audit export — organization — 2026-07-01 to 2026-09-30"), csv);
  assert.ok(csv.includes("Metadata only"), csv);
  assert.ok(csv.includes("created_at,member,application,action,finding_count,finding_kinds,finding_categories"));
  assert.ok(csv.includes('"ada@example.com"'));
  assert.ok(csv.includes('"email|api_key"'));
  assert.ok(!csv.includes("INCOMPLETE"), "a complete export must not warn");
}

{
  // The whole point of the rewrite. The export used to be built from the rows
  // the screen happened to hold — capped at fifty — under a filename that read
  // as the organization's record. A file that looks complete and is not is
  // worse than no export, because it is the one handed to an auditor.
  const csv = auditCsv([event], emails, "org", null, null, true);
  assert.ok(csv.includes("INCOMPLETE"), "a truncated export must say so, on its own first lines");
  assert.ok(csv.includes("Narrow the date range"), "and must say what to do about it");
  assert.ok(csv.indexOf("INCOMPLETE") < csv.indexOf("created_at,member"), "the warning must precede the data");
}

{
  // No range given is a legitimate audit question, not an error.
  const csv = auditCsv([], new Map(), "account", null, null, false);
  assert.ok(csv.includes("all recorded activity"));
  assert.ok(csv.includes("account"));
  assert.ok(csv.includes("0 event(s)"));
}

{
  // An unresolved member is an empty cell, never the raw UUID. The user_id is
  // internal, and a CSV that leaks it hands out a stable identifier for a
  // person that the rest of the product never exposes.
  const csv = auditCsv([event], new Map(), "org", null, null, false);
  assert.ok(!csv.includes("user-1"), "the internal id must not reach the export");
  assert.ok(csv.includes('"2026-08-14T09:12:00.000Z","",'), csv);
}

console.log("Redaxa audit export tests passed.");
