// Builds the public detection reference (/detectors/) from the real engine.
// Words come from site-detectors-catalog.mjs; every claim about behaviour (flagged
// or not, label, severity, placeholder, redacted text, service guidance, repository
// verdict) is computed here by running the compiled engine on the catalog's
// synthetic examples. A catalog entry that no longer matches the engine stops the
// build, so the pages cannot drift from what Redaxa actually does.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { CATEGORIES, DETECTORS, UPDATED } from "./site-detectors-catalog.mjs";

export const ORIGIN = "https://redaxa.getcertsprint.com";
export const CWS = "https://chromewebstore.google.com/detail/redaxa/clkobbjoaegkgnmkibjghlboeoplpmok";
const SOURCE = "https://github.com/AurelioAvila/redaxa/blob/";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ld = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

// Severity is decided in the engine; these are the meanings written next to it in scanner.ts.
const SEVERITY = {
  critical: "direct account or system compromise, as with keys, passwords and tokens",
  high: "direct financial exposure or a strong identifier, such as a card or national number",
  medium: "a personal identifier with real but indirect harm, such as an email, phone number or address",
  low: "a weak identifier that depends on context, such as a name or an IP address",
  info: "listed for context, not counted as an exposure",
};

export const BASE_CSS = ":root{color-scheme:light;font-family:system-ui,sans-serif;background:#f7f6f2;color:#1b1724;line-height:1.7}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:920px;margin:auto;padding:24px}header,footer{border-bottom:1px solid #e3dfd5}a{color:#a3471d}header a{font-weight:700}main{padding-top:48px}h1{font-size:clamp(2.2rem,6vw,3.8rem);line-height:1.06;letter-spacing:-.04em;max-width:820px;margin:.2em 0 .4em}h2{line-height:1.2}p,li,td,th,dd{color:#3a3446}section{margin:28px 0;padding:28px;border:1px solid #e3dfd5;border-radius:16px;background:#ffffff}.label{color:#a3471d;letter-spacing:.1em;font-size:.8rem;text-transform:uppercase}.crumbs{font-size:.9rem;color:#5a5466}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f0ea;padding:16px 18px;border-radius:10px;font-size:.95rem;margin:.4em 0 1em}code{background:#f2f0ea;padding:2px 6px;border-radius:6px;font-size:.92em;overflow-wrap:anywhere}.button{display:inline-block;background:#a3471d;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;margin:6px 8px 6px 0}.button.ghost{background:transparent;color:#a3471d;border:1px solid #a3471d}:focus-visible{outline:3px solid #a3471d;outline-offset:4px}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid #e3dfd5}th{width:34%;font-weight:600;color:#1b1724}.k{margin:.8em 0 0;font-weight:600;color:#1b1724}.note{font-size:.92rem;color:#5a5466}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px}dt{font-weight:600}dd{margin:0}ul{padding-left:1.3em}.tag{display:inline-block;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid #d9d4c8;border-radius:6px;padding:0 6px;margin-left:6px;color:#5a5466}@media(max-width:600px){section{padding:18px}main{padding-top:24px}th{width:auto}dl{grid-template-columns:1fr}.wide{display:block;overflow-x:auto}}";

const FOOTER = `<footer><a href="/">Redaxa home</a> · <a href="/detectors/">Detection reference</a> · <a href="/github.html">Repository check</a> · <a href="/api-docs.html">Scan API</a> · <a href="/privacy.html">Privacy</a> · <a href="https://github.com/AurelioAvila/redaxa">Source and releases</a></footer><script src="/cf-beacon.js" defer></script>`;

/** One page: head with canonical, Open Graph and a JSON-LD graph, the shared look, header and footer. */
export function pageShell({ lang = "en", title, description, url, graph, body, alternates = [], css = "" }) {
  const alt = alternates.map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}">`).join("");
  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">${alt}
<meta property="og:type" content="article"><meta property="og:site_name" content="Redaxa"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:locale" content="${lang}">
<meta property="og:image" content="${ORIGIN}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${ORIGIN}/og-image.png">
<link rel="icon" type="image/svg+xml" href="/outputs/redaxa-mark.svg">
<script type="application/ld+json">${ld({ "@context": "https://schema.org", "@graph": graph })}</script>
<style>${BASE_CSS}${css}</style></head><body>
<header><a href="/">Redaxa</a> · Privacy, before AI</header><main>
${body}
</main>${lang === "en" ? FOOTER : ""}</body></html>
`;
}

const ORG = { "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "Redaxa", url: `${ORIGIN}/`, logo: `${ORIGIN}/og-image.png`, founder: { "@type": "Person", name: "Aurelio Avila" } };
const AUTHOR = { "@type": "Person", name: "Aurelio Avila", url: "https://github.com/AurelioAvila" };
const crumbs = (items) => ({ "@type": "BreadcrumbList", itemListElement: items.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) });

function commitSha(root) {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL(".", root), encoding: "utf8" }).trim(); } catch { return "main"; }
}

/** Line (1-based) of the first line containing `needle`, or null. */
function lineOf(text, needle) {
  const i = text.split("\n").findIndex((l) => l.includes(needle));
  return i < 0 ? null : i + 1;
}

const placeholderOf = (f) => f.replacement.includes("$") ? "[REDACTED] (the word before it stays)" : f.replacement;
const OPTIONS = (terms) => ({ includePersonalData: true, includeCredentials: true, includeFinancialData: true, customTerms: terms });

/** Runs every catalog example through the engine; throws on any mismatch. */
export async function evaluate(root) {
  const { inspectPrompt } = await import(new URL("dist/scanner.js", root));
  const { inspectFile } = await import(new URL("dist/repository-scanner.js", root));
  const scannerSrc = readFileSync(new URL("scanner.ts", root), "utf8");
  const contextSrc = readFileSync(new URL("credential-context.ts", root), "utf8");
  const sha = commitSha(root);
  const problems = [];
  const slugs = new Set();
  const pages = DETECTORS.map((d) => {
    if (slugs.has(d.slug)) problems.push(`${d.slug}: duplicate slug`);
    slugs.add(d.slug);
    if (!CATEGORIES[d.category]) problems.push(`${d.slug}: unknown category ${d.category}`);
    const examples = d.examples.map((e) => {
      const r = inspectPrompt(e.text, OPTIONS(e.terms));
      const main = r.findings.filter((f) => f.label === e.label);
      if (!main.length) problems.push(`${d.slug}: example not flagged as "${e.label}" (got ${r.findings.map((f) => f.label).join(", ") || "nothing"})`);
      return { ...e, findings: r.findings, redacted: r.redactedText };
    });
    const mainLabel = d.examples[0].label;
    const near = d.near.map((n) => {
      const r = inspectPrompt(n.text, OPTIONS(n.terms));
      if (r.findings.some((f) => f.label === mainLabel)) problems.push(`${d.slug}: near miss is flagged as "${mainLabel}": ${n.text.slice(0, 60)}`);
      return { ...n, labels: [...new Set(r.findings.map((f) => f.label))] };
    });
    const fp = d.fp.map((n) => {
      const r = inspectPrompt(n.text, OPTIONS(n.terms));
      if (!r.findings.length) problems.push(`${d.slug}: declared false positive is not flagged: ${n.text.slice(0, 60)}`);
      return { ...n, labels: [...new Set(r.findings.map((f) => f.label))] };
    });
    let repo = null;
    if (d.repoPath) {
      const file = d.repoPath.split("/").pop();
      const verdict = (path) => inspectFile(path, d.examples[0].text).map((f) => ({ path, label: f.label, disposition: f.disposition, severity: f.severity, reason: f.reason }));
      repo = { main: verdict(d.repoPath), test: verdict(`tests/fixtures/${file}`) };
      if (!repo.main.length) problems.push(`${d.slug}: repository check finds nothing in ${d.repoPath}`);
    }
    const ruleLine = lineOf(scannerSrc, `label: "${mainLabel}"`);
    if (!ruleLine) problems.push(`${d.slug}: no rule labelled "${mainLabel}" in scanner.ts`);
    const services = [...new Set(examples.flatMap((e) => e.findings.map((f) => f.credential?.service).filter(Boolean)))];
    const contextLines = services.map((s) => ({ service: s, line: lineOf(contextSrc, s === "Unknown service" ? "let context:CredentialContext" : `'${s}'`) }));
    return { ...d, examples, near, fp, repo, mainLabel, ruleLine, contextLines, sha };
  });
  if (problems.length) throw new Error("Detection reference does not match the engine:\n- " + problems.join("\n- "));
  return pages;
}

function findingRows(f) {
  const rows = [["Reported as", esc(f.label)], ["Severity", `${esc(f.severity)}: ${esc(SEVERITY[f.severity] ?? "")}`], ["Replaced with", `<code>${esc(placeholderOf(f))}</code>`]];
  const c = f.credential;
  if (c) rows.push(["Probable service", esc(c.service)], ["Credential type", esc(c.type)], ["Evidence", esc(c.evidence)], ["Recommended action", esc(c.response)]);
  return rows;
}

const table = (rows) => `<div class="wide"><table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("")}</tbody></table></div>`;
const shown = (labels) => labels.length ? `flagged as ${labels.map((l) => `<strong>${esc(l)}</strong>`).join(", ")}` : "<strong>not flagged</strong>";

function detectorBody(p, facts, all) {
  const url = `${ORIGIN}/detectors/${p.slug}.html`;
  const cat = CATEGORIES[p.category];
  const first = p.examples[0].findings.find((f) => f.label === p.mainLabel);
  const where = p.category === "custom"
    ? "Web workspace and Windows app (free, your own list); Chrome extension with Pro; shared team list with Business. Terms are checked on Redaxa's server and the text is not stored."
    : "The same engine runs in the Chrome extension (free checks, on your device), in the web check and the Windows app (on Redaxa's server; the text is not stored) and in public repository checks.";
  const glance = table([
    ["Reported as", esc(p.mainLabel)],
    ["Category", esc(cat.name)],
    ["Severity", `${esc(first.severity)}: ${esc(SEVERITY[first.severity])}`],
    ["Replaced with", `<code>${esc(placeholderOf(first))}</code>`],
    ["Where it runs", esc(where)],
    ["Engine rule", `<a href="${SOURCE}${p.sha}/scanner.ts#L${p.ruleLine}">scanner.ts, line ${p.ruleLine}</a>`],
  ]);
  const examples = p.examples.map((e, i) => `<h3>${p.examples.length > 1 ? `Example ${i + 1}` : "Example"}</h3>
<p class="k">You paste</p><pre>${esc(e.text)}</pre>
<p class="k">Redaxa returns</p><pre>${esc(e.redacted)}</pre>
${e.findings.map((f) => table(findingRows(f))).join("")}`).join("\n");
  const guidance = [...new Set(p.examples.flatMap((e) => e.findings.map((f) => f.credential?.guidance).filter(Boolean)))];
  const docs = [...new Set(p.examples.flatMap((e) => e.findings.map((f) => f.credential?.docs).filter(Boolean)))];
  const repo = p.repo ? `<section><h2>In a repository check</h2>
<p>The same example, committed to a public repository and run through the <a href="/github.html">free repository check</a>:</p>
<ul>${p.repo.main.map((v) => `<li><code>${esc(v.path)}</code>: <strong>${esc(v.label)}</strong>, ${v.disposition === "review" ? "listed for review" : "listed as a reference, not counted as an exposure"} (severity ${esc(v.severity)}). <span class="note">${esc(v.reason)}</span></li>`).join("")}
${p.repo.test.map((v) => `<li>Same value in <code>${esc(v.path)}</code>: ${v.disposition === "review" ? `still listed for review. <span class="note">${esc(v.reason)}</span>` : esc(v.reason)}</li>`).join("")}</ul>
<p class="note">Values are always shown masked in repository reports. No key is ever tested against its provider.</p></section>` : "";
  const near = p.near.length ? `<section><h2>What it does not flag</h2><ul>${p.near.map((n) => `<li><code>${esc(n.text)}</code>: ${n.labels.length ? `not flagged as ${esc(p.mainLabel)}; ${shown(n.labels)}` : shown([])}. ${esc(n.why)}</li>`).join("")}</ul></section>` : "";
  const fp = p.fp.length ? `<section><h2>Known false positives</h2><p>Text that is harmless but still flagged today. Listed so you can recognise it, not hidden.</p><ul>${p.fp.map((n) => `<li><code>${esc(n.text)}</code>: ${shown(n.labels)}. ${esc(n.why)}</li>`).join("")}</ul></section>` : "";
  const after = `<section><h2>${p.category === "credentials" ? "If it already leaked" : "What to do"}</h2><p>${esc(p.after)}</p>${guidance.map((g) => `<p>What Redaxa adds to every finding of this kind: <em>${esc(g)}</em></p>`).join("")}${docs.length ? `<p>Official guidance: ${docs.map((d) => `<a href="${esc(d)}" rel="noopener">${esc(new URL(d).hostname)}</a>`).join(", ")}.</p>` : ""}</section>`;
  const cta = p.category === "custom"
    ? `<section><h2>Set up your list</h2><p>Add your terms in the <a href="/dashboard.html">web workspace</a> under Protected terms, or in the Windows app. ${esc(facts.trial.short)} <a href="/#pricing">See plans</a>.</p></section>`
    : `<section><h2>Check before you paste</h2><p>The free Chrome extension runs this check inside ChatGPT, Claude, Gemini and Perplexity before a message is sent, on your device and with no daily limit. On the web you get 5 free prompt checks a day with no account.</p><a class="button" href="${CWS}">Add the Chrome extension</a><a class="button ghost" href="/#scanner">Try a free web check</a>${p.category === "credentials" ? `<p>Worried it is already in your code? <a href="/github.html">Check a public GitHub repository free</a> (3 checks a day).</p>` : ""}</section>`;
  const related = all.filter((o) => o.category === p.category && o.slug !== p.slug);
  const rel = `<section><h2>Related</h2><ul>${related.map((o) => `<li><a href="/detectors/${o.slug}.html">${esc(o.name)}</a></li>`).join("")}<li><a href="/detectors/">Everything Redaxa detects</a></li></ul></section>`;
  const sources = `<section><h2>Sources</h2><ul><li>Redaxa engine: <a href="${SOURCE}${p.sha}/scanner.ts#L${p.ruleLine}">scanner.ts line ${p.ruleLine}</a>${p.contextLines.filter((c) => c.line).map((c) => `, <a href="${SOURCE}${p.sha}/credential-context.ts#L${c.line}">credential-context.ts line ${c.line}</a> (${esc(c.service)})`).join("")}. Every output on this page was produced by that code when the page was built.</li>${p.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a></li>`).join("")}</ul></section>`;
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Redaxa</a> › <a href="/detectors/">Detection reference</a> › ${esc(p.name)}</nav>
<p class="label">Detection reference · ${esc(cat.name)} · Updated ${UPDATED}</p>
<h1>${esc(p.h1)}</h1>
<p class="lead">${esc(p.intro)}</p>
<section><h2>At a glance</h2>${glance}</section>
<section><h2>What it looks like</h2><p>${p.format}</p>${examples}
<p class="note">${p.examples.some((e) => e.exampleNote) ? p.examples.map((e) => e.exampleNote).filter(Boolean).map(esc).join(" ") + " " : ""}All values on this page are synthetic or published specimens; none is a working credential or a real person's data.</p></section>
${repo}${near}${fp}${after}${cta}${rel}${sources}`;
  const graph = [
    ORG,
    { "@type": "TechArticle", "@id": `${url}#article`, headline: p.h1, description: p.description, url, inLanguage: "en", datePublished: UPDATED, dateModified: UPDATED, author: AUTHOR, publisher: { "@id": `${ORIGIN}/#organization` }, isPartOf: { "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "Redaxa", url: `${ORIGIN}/` }, about: p.name, mainEntityOfPage: url },
    crumbs([["Redaxa", `${ORIGIN}/`], ["Detection reference", `${ORIGIN}/detectors/`], [p.name, url]]),
  ];
  return { path: `detectors/${p.slug}.html`, url, html: pageShell({ title: `${p.title} | Redaxa`, description: p.description, url, graph, body }) };
}

function hub(pages, facts) {
  const url = `${ORIGIN}/detectors/`;
  const groups = Object.entries(CATEGORIES).map(([key, c]) => {
    const rows = pages.filter((p) => p.category === key);
    return `<section><h2>${esc(c.name)}</h2><p>${esc(c.blurb)}</p><div class="wide"><table><thead><tr><th scope="col">What</th><th scope="col">Reported as</th><th scope="col">Severity</th><th scope="col">Replaced with</th></tr></thead><tbody>${rows.map((p) => { const f = p.examples[0].findings.find((x) => x.label === p.mainLabel); return `<tr><td><a href="/detectors/${p.slug}.html">${esc(p.name)}</a></td><td>${esc(p.mainLabel)}</td><td>${esc(f.severity)}</td><td><code>${esc(placeholderOf(f))}</code></td></tr>`; }).join("")}</tbody></table></div></section>`;
  }).join("\n");
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Redaxa</a> › Detection reference</nav>
<p class="label">Detection reference · Updated ${UPDATED}</p>
<h1>What Redaxa detects</h1>
<p class="lead">Every type of sensitive data Redaxa recognises in a prompt or a public repository, with the exact output its engine produces, what it deliberately skips and the false positives it still has. ${pages.length} pages, generated from the engine itself when the site is built.</p>
<section><h2>How to read these pages</h2><ul><li><strong>Severity</strong> is set by the engine for the kind of data. Critical: ${SEVERITY.critical}. High: ${SEVERITY.high}. Medium: ${SEVERITY.medium}. Low: ${SEVERITY.low}.</li><li><strong>One engine everywhere.</strong> The Chrome extension's free checks run it in your browser; the web check and the Windows app run it on Redaxa's server without storing the text; repository checks run it on the files of a public repository.</li><li><strong>No check proves a text is safe.</strong> Detection can miss sensitive information or flag harmless text; each page lists the misses and false positives we know about.</li><li><strong>Nothing is verified with a provider.</strong> Redaxa never tests whether a key works.</li></ul></section>
${groups}
<section><h2>Try it</h2><a class="button" href="${CWS}">Add the free Chrome extension</a><a class="button ghost" href="/#scanner">Try a web check</a><a class="button ghost" href="/github.html">Check a public repository</a><p class="note">${esc(facts.trial.short)}</p></section>`;
  const graph = [
    ORG,
    { "@type": "CollectionPage", "@id": `${url}#page`, name: "What Redaxa detects", description: "The detection reference for Redaxa's engine.", url, inLanguage: "en", dateModified: UPDATED, isPartOf: { "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "Redaxa", url: `${ORIGIN}/` }, mainEntity: { "@type": "ItemList", itemListElement: pages.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${ORIGIN}/detectors/${p.slug}.html`, name: p.name })) } },
    crumbs([["Redaxa", `${ORIGIN}/`], ["Detection reference", url]]),
  ];
  const description = "Every kind of sensitive data Redaxa detects in AI prompts and public repositories: API keys, tokens, passwords, personal and financial data, with real engine output.";
  return { path: "detectors/index.html", url, html: pageShell({ title: "What Redaxa Detects: API Keys, Tokens, PII | Redaxa", description, url, graph, body }) };
}

/** All detection reference pages plus the hub, ready to write under public/. */
export async function buildDetectors(root, facts) {
  const pages = await evaluate(root);
  const out = pages.map((p) => detectorBody(p, facts, pages));
  return { pages, files: [hub(pages, facts), ...out], updated: UPDATED };
}
