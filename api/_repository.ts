import { parseRepository, scanRepository } from "../repository-scanner.js";
import { rateLimited, rateLimitedShared } from "./_rateLimit.js";

type ResponseLike = { status(code: number): ResponseLike; json(value: unknown): void };
type Service = (path: string, init?: RequestInit) => Promise<Response>;

/** Free web checks of public repositories per day. Paid plans get a working
 *  allowance; the local Windows check (history, archives, revealed values)
 *  stays the Pro feature. */
const freeDailyRepositoryChecks = 3;
const paidDailyRepositoryChecks = 60;
const maxFindings = 1000;
// Whole-service ceiling: each check can hold a function for up to 50 s, and the
// hosting plan's monthly compute is shared with every other endpoint.
const globalDailyRepositoryChecks = 1500;
const maxAdvisories = 300;

/**
 * Web repository check: public GitHub repositories only, read from the public
 * archive (no GitHub API quota), values never included. Masked findings point
 * at files that are already public; nothing here makes a secret easier to use.
 */
export async function handleRepositoryCheck(
  input: unknown,
  who: { userId: string | null; paid: boolean; ip: string },
  service: Service,
  response: ResponseLike
): Promise<void> {
  if (typeof input !== "string" || input.length > 300) { response.status(400).json({ error: "Paste a public GitHub repository link." }); return; }
  try { parseRepository(input.trim()); } catch (error) {
    const message = error instanceof Error && /^(Use the repository home URL|Invalid repository)/.test(error.message) ? error.message : "Paste a public GitHub repository link, such as https://github.com/owner/project.";
    response.status(400).json({ error: message });
    return;
  }
  const key = who.userId ? `repo:${who.paid ? "paid" : "free"}:${who.userId}` : `repo:anon:${who.ip}`;
  const limit = who.paid ? paidDailyRepositoryChecks : freeDailyRepositoryChecks;
  if (rateLimited(key, limit, 86_400_000) || await rateLimitedShared(service, key, limit, 86_400)) {
    response.status(402).json({ error: "REPOSITORY_LIMIT", limit });
    return;
  }
  if (await rateLimitedShared(service, "repo:global", globalDailyRepositoryChecks, 86_400)) {
    response.status(503).json({ error: "Repository checks are busy today. Please try again tomorrow, or use the Windows app." });
    return;
  }
  let report;
  try {
    // Stay inside the function's time budget; a partial scan is reported as such.
    report = await scanRepository(input.trim(), undefined, fetch, false, { archiveOnly: true, timeoutMs: 50_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = /^(Repository unavailable|The repository archive could not)/.test(message);
    response.status(known ? 400 : 502).json({ error: known ? message : "The repository could not be checked right now. Please try again." });
    return;
  }
  // Same shape as the desktop report so the page reuses one renderer. Values
  // are absent (allowReveal=false); coverage keeps only skipped files.
  const skipped = report.coverage.filter(c => c.status !== "scanned");
  response.status(200).json({
    ...report,
    findings: report.findings.slice(0, maxFindings),
    findingsTruncated: report.findingsTruncated || report.findings.length > maxFindings,
    coverage: skipped.slice(0, 500),
    dependencies: report.dependencies && { ...report.dependencies, advisories: report.dependencies.advisories.slice(0, maxAdvisories) },
    hosted: true
  });
}
