// Shared by the popup and the content script: translated text and how
// findings are ordered, labelled and explained. Classic script, so the
// functions below are globals in both places.

// The extension resolves the user's language (en, it, es, fr, de; English
// otherwise). Outside the extension, the local design preview reads English.
let previewMessages;
function t(key, substitutions) {
  if (globalThis.chrome?.i18n) return chrome.i18n.getMessage(key, substitutions);
  if (previewMessages === undefined) {
    try {
      const request = new XMLHttpRequest();
      request.open("GET", "_locales/en/messages.json", false);
      request.send();
      previewMessages = JSON.parse(request.responseText);
    } catch { previewMessages = {}; }
  }
  const entry = previewMessages[key];
  const values = [].concat(substitutions ?? []);
  return entry ? entry.message.replace(/\$(\w+)\$/g, (_, name) => entry.placeholders?.[name.toLowerCase()]?.content ?? "")
    .replace(/\$(\d)/g, (_, i) => values[i - 1] ?? "") : "";
}

const english = () => t("locale") === "en";
const isCredential = (f) => f.category === "credentials" || ["secret", "privateKey", "credential"].includes(f.kind);

function findingPriority(findings) {
  const severity = { critical: 4, high: 3, medium: 2, low: 1 };
  return [...findings].sort((a, b) => Number(b.kind === "secret") - Number(a.kind === "secret")
    || Number(isCredential(b)) - Number(isCredential(a)) || (severity[b.severity] || 0) - (severity[a.severity] || 0));
}

function findingLabel(f) {
  return t(`kind_${f.kind}`) || f.label;
}

// The engine explains credentials in English. Other languages get the
// service name, a translated next step and one translated caution.
const responseKeys = {
  "Identify owner, then rotate if genuine": "respIdentify",
  "Revoke or rotate if genuine": "respRotate",
  "Check restrictions and exposure": "respGoogle",
  "Check whether the secret is also exposed": "respAws",
  "Review link exposure": "respLink",
  "Check issuer and session permissions": "respJwt",
  "No automatic revocation recommended": "respReference"
};

function findingTitle(f) {
  const c = f.credential;
  if (!c) return findingLabel(f);
  if (english()) return `${c.service} · ${c.type}`;
  const service = c.service.replace(/ \(.*\)$/, "");
  return ["Unknown service", "Issuer not established"].includes(service) ? findingLabel(f) : `${service} · ${findingLabel(f)}`;
}

function credentialAdvice(c) {
  if (english()) return { summary: c.response, body: `${c.evidence} ${c.guidance}` };
  const key = responseKeys[c.response];
  return { summary: (key && t(key)) || c.response, body: t("credentialNote") };
}

// One row per label, most urgent first: "Email address × 2".
function groupFindings(findings) {
  const groups = new Map();
  for (const f of findingPriority(findings)) {
    const title = findingTitle(f);
    const group = groups.get(title) ?? { title, count: 0, credential: f.credential };
    group.count++;
    groups.set(title, group);
  }
  return [...groups.values()];
}

const policyKeys = {
  "default-credentials": "policyCredentials", "default-financial": "policyFinancial",
  "default-personal": "policyPersonal", "default-custom-terms": "policyCustom",
  "org-credentials": "policyOrgCredentials", "org-financial": "policyOrgFinancial",
  "org-personal": "policyOrgPersonal", "org-custom": "policyOrgCustom"
};

function policyReason(decision) {
  const rule = decision?.decidedBy;
  const key = policyKeys[rule?.ruleId];
  return (key && t(key)) || rule?.reason || "";
}
