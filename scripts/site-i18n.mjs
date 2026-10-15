// Landing pages in the product's other languages (/it/, /es/, /fr/, /de/): the
// languages the Chrome extension, the workspace, the trial and the emails already
// ship in. Plan benefits, FAQ answers, trial wording and price formats are the
// product's own translations, read from dashboard.ts and trial.ts (the extension's
// store names are copied below, because Vercel does not upload browser-extension/);
// only the page's framing below is written here.
import { readFileSync } from "node:fs";
import { sourceLiteral } from "./source-literal.mjs";
import { CWS, ORIGIN, esc, pageShell } from "./site-detectors.mjs";

export const LANGUAGES = [
  { code: "it", name: "Italiano", ogLocale: "it_IT" },
  { code: "es", name: "Español", ogLocale: "es_ES" },
  { code: "fr", name: "Français", ogLocale: "fr_FR" },
  { code: "de", name: "Deutsch", ogLocale: "de_DE" },
];

// Keywords checked with Google autocomplete on 15/10/2026 (hl/gl per language):
// it "dati sensibili chatgpt", "inserire dati sensibili su chatgpt"; es "datos sensibles chatgpt",
// "chatgpt datos personales"; fr "données sensibles chatgpt", "chatgpt données personnelles";
// de "sensible daten chatgpt", "sensible daten mit chatgpt teilen", "chatgpt personenbezogene daten".
const WORDS = {
  it: {
    // The extension's store name in this language (browser-extension/_locales; checked by site-pages.test.mjs).
    eyebrow: "Redaxa – Oscura dati personali e chiavi API per ChatGPT, Claude, Gemini",
    title: "Dati sensibili e ChatGPT: oscurali prima dell'invio | Redaxa",
    description: "Redaxa controlla il prompt prima che arrivi a ChatGPT, Claude, Gemini o Perplexity e oscura chiavi API, password e dati personali. Controlli gratuiti sul tuo dispositivo.",
    h1: "Condividi il lavoro con l'AI.<br>Tieni per te i dati sensibili.",
    lead: "Prima di inserire dati sensibili su ChatGPT, lascia che Redaxa controlli il testo: email, numeri di telefono, IBAN, carte, chiavi API e password vengono segnalati e sostituiti in una versione oscurata. Decidi tu cosa inviare.",
    ctaExt: "Aggiungi l'estensione per Chrome", ctaExtNote: "Gratis, senza account e senza limite giornaliero.",
    ctaWin: "Scarica l'app per Windows", ctaWeb: "Apri lo spazio di lavoro web", ctaWebNote: "Si apre in italiano: 5 controlli gratuiti al giorno, senza account.",
    findTitle: "Cosa trova",
    find: [
      "<strong>Dati personali:</strong> indirizzi email, numeri di telefono, nomi dopo un saluto, indirizzi in formato inglese, indirizzi IPv4, codici fiscali italiani, Social Security Number statunitensi e National Insurance number britannici.",
      "<strong>Dati finanziari:</strong> numeri di carta (con controllo di Luhn), IBAN (con controllo mod 97) e indirizzi di wallet crypto.",
      "<strong>Credenziali:</strong> chiavi API e token di oltre dieci fornitori (GitHub, OpenAI, Anthropic, Stripe, AWS, Google, Slack e altri), password, chiavi private e segreti nei file di configurazione.",
      "<strong>I tuoi termini protetti:</strong> nomi di clienti e progetti che nessun modello può conoscere.",
    ],
    findNote: "Il rilevamento può non trovare qualcosa o segnalare testo innocuo: rivedi sempre il risultato. Il riferimento completo, con esempi reali del motore, è in inglese:",
    findLink: "cosa rileva Redaxa",
    whereTitle: "Dove funziona",
    where: [
      "<strong>Estensione per Chrome:</strong> su ChatGPT, Claude, Gemini e Perplexity controlla il messaggio quando premi Invio, prima che parta. Se trova qualcosa scegli tu: versione oscurata o invio comunque.",
      "<strong>Web:</strong> nessuna installazione, 5 controlli gratuiti al giorno.",
      "<strong>App per Windows:</strong> gli stessi controlli, con aggiornamenti firmati; con Pro anche le revisioni locali dei repository GitHub pubblici, cronologia compresa.",
      "<strong>Repository GitHub pubblici:</strong> 3 controlli gratuiti al giorno sul web, con i valori sempre mascherati.",
    ],
    privacyTitle: "Cosa esce dal tuo dispositivo",
    privacy: [
      "<strong>Controlli gratuiti nell'estensione:</strong> niente. Avvengono nel browser.",
      "<strong>Controlli sul web, su Windows e con un piano:</strong> il testo viaggia su una connessione cifrata, viene analizzato ed eliminato. Non viene conservato né inoltrato a un fornitore di AI.",
      "<strong>Registro attività:</strong> solo metadati (ora, applicazione, categorie e numero di risultati), mai il testo.",
    ],
    paused: "Se un pagamento non va a buon fine, il piano resta sospeso finché un pagamento non riesce.",
    plansCta: "Scegli un piano", vat: "Prezzi IVA esclusa. Pagamenti gestiti da Stripe.",
    verifyTitle: "Verifica il download per Windows",
    verify: (t) => `Redaxa ${t.version}: SHA-256 <code>${t.sha256}</code>. Firma Authenticode valida, editore ${esc(t.signature.signer)}${t.signature.timestamped ? ", con marca temporale" : ""}. In PowerShell: <code>Get-FileHash .\\Redaxa-Setup.exe -Algorithm SHA256</code> e <code>Get-AuthenticodeSignature .\\Redaxa-Setup.exe</code>.`,
    winget: "Oppure con winget:",
    moreTitle: "Approfondimenti (in inglese)",
    footer: "Informativa privacy e termini (in inglese)",
  },
  es: {
    // The extension's store name in this language (browser-extension/_locales; checked by site-pages.test.mjs).
    eyebrow: "Redaxa – Oculta datos personales y claves API en ChatGPT, Claude, Gemini",
    title: "Datos sensibles y ChatGPT: ocúltalos antes de enviar | Redaxa",
    description: "Redaxa revisa el prompt antes de que llegue a ChatGPT, Claude, Gemini o Perplexity y oculta claves API, contraseñas y datos personales. Análisis gratuitos en tu dispositivo.",
    h1: "Comparte el trabajo con la IA.<br>Guarda los datos sensibles.",
    lead: "Antes de que tus datos personales lleguen a ChatGPT, deja que Redaxa revise el texto: correos, teléfonos, IBAN, tarjetas, claves API y contraseñas se señalan y se sustituyen en una versión oculta. Tú decides qué se envía.",
    ctaExt: "Añadir la extensión para Chrome", ctaExtNote: "Gratis, sin cuenta y sin límite diario.",
    ctaWin: "Descargar la app para Windows", ctaWeb: "Abrir el espacio de trabajo web", ctaWebNote: "Se abre en español: 5 revisiones gratuitas al día, sin cuenta.",
    findTitle: "Qué detecta",
    find: [
      "<strong>Datos personales:</strong> correos electrónicos, números de teléfono, nombres después de un saludo, direcciones en formato inglés, direcciones IPv4, números de la Seguridad Social de EE. UU., números de National Insurance del Reino Unido y códigos fiscales italianos.",
      "<strong>Datos financieros:</strong> números de tarjeta (con verificación de Luhn), IBAN (con verificación módulo 97) y direcciones de wallets de criptomonedas.",
      "<strong>Credenciales:</strong> claves API y tokens de más de diez proveedores (GitHub, OpenAI, Anthropic, Stripe, AWS, Google, Slack y otros), contraseñas, claves privadas y secretos en archivos de configuración.",
      "<strong>Tus términos protegidos:</strong> nombres de clientes y proyectos que ningún modelo puede conocer.",
    ],
    findNote: "La detección puede pasar algo por alto o marcar texto inofensivo: revisa siempre el resultado. La referencia completa, con ejemplos reales del motor, está en inglés:",
    findLink: "qué detecta Redaxa",
    whereTitle: "Dónde funciona",
    where: [
      "<strong>Extensión para Chrome:</strong> en ChatGPT, Claude, Gemini y Perplexity revisa el mensaje al pulsar Intro, antes de que salga. Si encuentra algo, eliges tú: versión oculta o enviar de todos modos.",
      "<strong>Web:</strong> sin instalar nada, 5 revisiones gratuitas al día.",
      "<strong>App para Windows:</strong> las mismas revisiones, con actualizaciones firmadas; con Pro, también revisiones locales de repositorios públicos de GitHub, historial incluido.",
      "<strong>Repositorios públicos de GitHub:</strong> 3 revisiones gratuitas al día en la web, con los valores siempre ocultos.",
    ],
    privacyTitle: "Qué sale de tu dispositivo",
    privacy: [
      "<strong>Revisiones gratuitas en la extensión:</strong> nada. Se hacen en el navegador.",
      "<strong>Revisiones en la web, en Windows y con un plan:</strong> el texto viaja por una conexión cifrada, se analiza y se descarta. No se guarda ni se reenvía a ningún proveedor de IA.",
      "<strong>Registro de actividad:</strong> solo metadatos (hora, aplicación, categorías y número de hallazgos), nunca el texto.",
    ],
    paused: "Si un pago no se completa, el plan queda en pausa hasta que se complete un pago.",
    plansCta: "Elegir un plan", vat: "Precios sin IVA. Pagos gestionados por Stripe.",
    verifyTitle: "Verifica la descarga para Windows",
    verify: (t) => `Redaxa ${t.version}: SHA-256 <code>${t.sha256}</code>. Firma Authenticode válida, editor ${esc(t.signature.signer)}${t.signature.timestamped ? ", con sello de tiempo" : ""}. En PowerShell: <code>Get-FileHash .\\Redaxa-Setup.exe -Algorithm SHA256</code> y <code>Get-AuthenticodeSignature .\\Redaxa-Setup.exe</code>.`,
    winget: "O con winget:",
    moreTitle: "Más información (en inglés)",
    footer: "Política de privacidad y términos (en inglés)",
  },
  fr: {
    // The extension's store name in this language (browser-extension/_locales; checked by site-pages.test.mjs).
    eyebrow: "Redaxa – Masquez clés API et données personnelles : ChatGPT, Claude, Gemini",
    title: "Données sensibles et ChatGPT : masquez-les avant l'envoi | Redaxa",
    description: "Redaxa vérifie le prompt avant qu'il n'arrive à ChatGPT, Claude, Gemini ou Perplexity et masque clés API, mots de passe et données personnelles. Vérifications gratuites sur votre appareil.",
    h1: "Partagez le travail avec l'IA.<br>Gardez les données sensibles.",
    lead: "Avant que vos données personnelles n'arrivent dans ChatGPT, laissez Redaxa vérifier le texte : e-mails, numéros de téléphone, IBAN, cartes, clés API et mots de passe sont signalés et remplacés dans une version masquée. C'est vous qui décidez de ce qui part.",
    ctaExt: "Ajouter l'extension Chrome", ctaExtNote: "Gratuite, sans compte et sans limite quotidienne.",
    ctaWin: "Télécharger l'application Windows", ctaWeb: "Ouvrir l'espace de travail web", ctaWebNote: "Il s'ouvre en français : 5 vérifications gratuites par jour, sans compte.",
    findTitle: "Ce qu'il repère",
    find: [
      "<strong>Données personnelles :</strong> adresses e-mail, numéros de téléphone, noms après une formule de salutation, adresses postales au format anglais, adresses IPv4, numéros de sécurité sociale américains, numéros de National Insurance britanniques et codes fiscaux italiens.",
      "<strong>Données financières :</strong> numéros de carte (avec contrôle de Luhn), IBAN (avec contrôle modulo 97) et adresses de portefeuilles crypto.",
      "<strong>Identifiants :</strong> clés API et jetons de plus de dix fournisseurs (GitHub, OpenAI, Anthropic, Stripe, AWS, Google, Slack et d'autres), mots de passe, clés privées et secrets dans les fichiers de configuration.",
      "<strong>Vos termes protégés :</strong> noms de clients et de projets qu'aucun modèle ne peut connaître.",
    ],
    findNote: "La détection peut manquer une information ou signaler un texte anodin : relisez toujours le résultat. La référence complète, avec de vrais exemples du moteur, est en anglais :",
    findLink: "ce que Redaxa détecte",
    whereTitle: "Où il fonctionne",
    where: [
      "<strong>Extension Chrome :</strong> sur ChatGPT, Claude, Gemini et Perplexity, elle vérifie le message quand vous appuyez sur Entrée, avant son envoi. Si elle trouve quelque chose, vous choisissez : version masquée ou envoi quand même.",
      "<strong>Web :</strong> rien à installer, 5 vérifications gratuites par jour.",
      "<strong>Application Windows :</strong> les mêmes vérifications, avec des mises à jour signées ; avec Pro, aussi l'analyse locale de dépôts GitHub publics, historique compris.",
      "<strong>Dépôts GitHub publics :</strong> 3 vérifications gratuites par jour sur le web, valeurs toujours masquées.",
    ],
    privacyTitle: "Ce qui quitte votre appareil",
    privacy: [
      "<strong>Vérifications gratuites dans l'extension :</strong> rien. Elles ont lieu dans le navigateur.",
      "<strong>Vérifications sur le web, sous Windows et avec une offre :</strong> le texte passe par une connexion chiffrée, il est analysé puis supprimé. Il n'est ni conservé ni transmis à un fournisseur d'IA.",
      "<strong>Journal d'activité :</strong> métadonnées uniquement (heure, application, catégories et nombre de résultats), jamais le texte.",
    ],
    paused: "Si un paiement échoue, l'offre est suspendue jusqu'à ce qu'un paiement aboutisse.",
    plansCta: "Choisir une offre", vat: "Prix HT. Paiements gérés par Stripe.",
    verifyTitle: "Vérifier le téléchargement Windows",
    verify: (t) => `Redaxa ${t.version} : SHA-256 <code>${t.sha256}</code>. Signature Authenticode valide, éditeur ${esc(t.signature.signer)}${t.signature.timestamped ? ", avec horodatage" : ""}. Dans PowerShell : <code>Get-FileHash .\\Redaxa-Setup.exe -Algorithm SHA256</code> et <code>Get-AuthenticodeSignature .\\Redaxa-Setup.exe</code>.`,
    winget: "Ou avec winget :",
    moreTitle: "Pour aller plus loin (en anglais)",
    footer: "Politique de confidentialité et conditions (en anglais)",
  },
  de: {
    // The extension's store name in this language (browser-extension/_locales; checked by site-pages.test.mjs).
    eyebrow: "Redaxa – Schwärzt API-Keys & persönliche Daten: ChatGPT, Claude, Gemini",
    title: "Sensible Daten mit ChatGPT teilen? Erst schwärzen | Redaxa",
    description: "Redaxa prüft den Prompt, bevor er an ChatGPT, Claude, Gemini oder Perplexity geht, und schwärzt API-Keys, Passwörter und personenbezogene Daten. Kostenlose Prüfungen auf Ihrem Gerät.",
    h1: "Arbeit mit KI teilen.<br>Sensible Daten behalten.",
    lead: "Bevor personenbezogene Daten in ChatGPT landen, prüft Redaxa den Text: E-Mail-Adressen, Telefonnummern, IBANs, Kartennummern, API-Keys und Passwörter werden markiert und in einer geschwärzten Fassung ersetzt. Sie entscheiden, was gesendet wird.",
    ctaExt: "Chrome-Erweiterung hinzufügen", ctaExtNote: "Kostenlos, ohne Konto und ohne Tageslimit.",
    ctaWin: "Windows-App herunterladen", ctaWeb: "Web-Arbeitsbereich öffnen", ctaWebNote: "Öffnet sich auf Deutsch: 5 kostenlose Prüfungen pro Tag, ohne Konto.",
    findTitle: "Was Redaxa findet",
    find: [
      "<strong>Personenbezogene Daten:</strong> E-Mail-Adressen, Telefonnummern, Namen nach einer Anrede, Adressen im englischen Format, IPv4-Adressen, US-Sozialversicherungsnummern, britische National-Insurance-Nummern und italienische Steuernummern (Codice fiscale).",
      "<strong>Finanzdaten:</strong> Kartennummern (mit Luhn-Prüfung), IBANs (mit Modulo-97-Prüfung) und Krypto-Wallet-Adressen.",
      "<strong>Zugangsdaten:</strong> API-Keys und Tokens von mehr als zehn Anbietern (GitHub, OpenAI, Anthropic, Stripe, AWS, Google, Slack und weitere), Passwörter, private Schlüssel und Geheimnisse in Konfigurationsdateien.",
      "<strong>Ihre geschützten Begriffe:</strong> Kunden- und Projektnamen, die kein Modell kennen kann.",
    ],
    findNote: "Die Erkennung kann etwas übersehen oder harmlosen Text markieren: Prüfen Sie das Ergebnis immer selbst. Die vollständige Referenz mit echten Ausgaben der Engine ist auf Englisch:",
    findLink: "was Redaxa erkennt",
    whereTitle: "Wo es läuft",
    where: [
      "<strong>Chrome-Erweiterung:</strong> Auf ChatGPT, Claude, Gemini und Perplexity prüft sie die Nachricht beim Drücken der Eingabetaste, bevor sie gesendet wird. Findet sie etwas, entscheiden Sie: geschwärzte Fassung oder trotzdem senden.",
      "<strong>Web:</strong> ohne Installation, 5 kostenlose Prüfungen pro Tag.",
      "<strong>Windows-App:</strong> dieselben Prüfungen mit signierten Updates; mit Pro außerdem lokale Prüfungen öffentlicher GitHub-Repositories samt Verlauf.",
      "<strong>Öffentliche GitHub-Repositories:</strong> 3 kostenlose Prüfungen pro Tag im Web, Werte immer maskiert.",
    ],
    privacyTitle: "Was Ihr Gerät verlässt",
    privacy: [
      "<strong>Kostenlose Prüfungen in der Erweiterung:</strong> nichts. Sie laufen im Browser.",
      "<strong>Prüfungen im Web, unter Windows und mit einem Tarif:</strong> Der Text wird verschlüsselt übertragen, analysiert und verworfen. Er wird weder gespeichert noch an einen KI-Anbieter weitergegeben.",
      "<strong>Aktivitätsprotokoll:</strong> nur Metadaten (Zeit, Anwendung, Kategorien und Anzahl der Funde), nie der Text.",
    ],
    paused: "Schlägt eine Zahlung fehl, ist der Tarif pausiert, bis eine Zahlung erfolgt.",
    plansCta: "Tarif wählen", vat: "Preise zzgl. MwSt. Zahlungen über Stripe.",
    verifyTitle: "Windows-Download prüfen",
    verify: (t) => `Redaxa ${t.version}: SHA-256 <code>${t.sha256}</code>. Gültige Authenticode-Signatur, Herausgeber ${esc(t.signature.signer)}${t.signature.timestamped ? ", mit Zeitstempel" : ""}. In PowerShell: <code>Get-FileHash .\\Redaxa-Setup.exe -Algorithm SHA256</code> und <code>Get-AuthenticodeSignature .\\Redaxa-Setup.exe</code>.`,
    winget: "Oder mit winget:",
    moreTitle: "Mehr dazu (auf Englisch)",
    footer: "Datenschutzerklärung und Bedingungen (auf Englisch)",
  },
};

const CSS = ".langs{float:right;font-size:.9rem}.langs a{margin-left:10px}.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.plan{border:1px solid #e3dfd5;border-radius:14px;padding:18px}.plan h3{margin:.1em 0}.price{font-size:1.5rem;font-weight:700;color:#1b1724;margin:.2em 0}.plan ul{padding-left:1.1em;font-size:.95rem}.faq h3{margin-bottom:.2em}@media(max-width:760px){.plans{grid-template-columns:1fr}.langs{float:none;display:block;margin-top:6px}}";

/** Language switcher and hreflang alternates shared by / and the localized pages. */
export function alternates() {
  return [{ hreflang: "en", href: `${ORIGIN}/` }, ...LANGUAGES.map((l) => ({ hreflang: l.code, href: `${ORIGIN}/${l.code}/` })), { hreflang: "x-default", href: `${ORIGIN}/` }];
}

export async function buildLanguages(root, facts) {
  const read = (f) => readFileSync(new URL(f, root), "utf8");
  const dashboard = read("dashboard.ts");
  const view = sourceLiteral(dashboard, "viewCopyByLanguage");
  const { TRIAL_UI, money } = await import(new URL("dist/trial.js", root));
  const offer = (name) => {
    const o = facts.app.offers.find((x) => x.name === name);
    if (!o) throw new Error(`offer ${name} missing`);
    return Math.round(Number(o.price) * 100);
  };
  const files = LANGUAGES.map(({ code, name, ogLocale }) => {
    const w = WORDS[code];
    const v = view[code];
    const t = TRIAL_UI[code];
    for (const key of ["freeName", "freeDesc", "freeNote", "freeB1", "freeB2", "freeB3", "freeB4", "proB1", "proB2", "proB3", "proB4", "bizB1", "bizB2", "bizB3", "bizB4", "plansHeadline", "faqTitle", "faqTrialQ", "faqTrialA", "faqCancelQ", "faqCancelA", "faqBizQ", "faqBizA", "faqStoredQ", "faqStoredA", "faqMissQ", "faqMissA", "recommended"]) {
      if (typeof v?.[key] !== "string") throw new Error(`dashboard.ts ${code}.${key} missing`);
    }
    const url = `${ORIGIN}/${code}/`;
    const fmt = (template, cents) => template.replace("{amount}", money(cents, "eur", code));
    const proPrice = `${fmt(t.perMonth, offer("Pro monthly"))} · ${fmt(t.perYear, offer("Pro yearly"))}`;
    const bizPrice = `${fmt(t.perUserMonth, offer("Business monthly (per user)"))} · ${fmt(t.perUserYear, offer("Business yearly (per user)"))}`;
    const trialQ = facts.trial.enabled ? t.copy.faqTrialQ : v.faqTrialQ;
    const trialA = facts.trial.enabled ? t.copy.faqTrialA : v.faqTrialA;
    const plansIntro = facts.trial.enabled ? t.copy.plansIntro : v.faqTrialA;
    const faq = [[trialQ, trialA], [v.faqCancelQ, v.faqCancelA], [v.faqBizQ, v.faqBizA], [v.faqStoredQ, v.faqStoredA], [v.faqMissQ, v.faqMissA]];
    const card = (title, price, note, items, featured) => `<article class="plan"${featured ? ' style="border-color:#a3471d"' : ""}><h3>${esc(title)}${featured ? ` <span class="tag">${esc(v.recommended)}</span>` : ""}</h3><p class="price">${esc(price)}</p>${note ? `<p class="note">${esc(note)}</p>` : ""}<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></article>`;
    const langs = `<nav class="langs" aria-label="Language"><a href="/" hreflang="en" lang="en">English</a>${LANGUAGES.map((l) => l.code === code ? `<strong style="margin-left:10px">${l.name}</strong>` : `<a href="/${l.code}/" hreflang="${l.code}" lang="${l.code}">${l.name}</a>`).join("")}</nav>`;
    const body = `${langs}
<p class="label">${esc(w.eyebrow)}</p>
<h1>${w.h1}</h1>
<p class="lead">${esc(w.lead)}</p>
<p><a class="button" href="${CWS}?hl=${code}">${esc(w.ctaExt)}</a><a class="button ghost" href="https://dl.pctweaker.app/redaxa/Redaxa-Setup.exe">${esc(w.ctaWin)}</a><a class="button ghost" href="/dashboard.html" data-workspace-lang="${code}">${esc(w.ctaWeb)}</a></p>
<p class="note">${esc(w.ctaExtNote)} ${esc(w.ctaWebNote)}</p>
<section><h2>${esc(w.findTitle)}</h2><ul>${w.find.map((x) => `<li>${x}</li>`).join("")}</ul><p class="note">${esc(w.findNote)} <a href="/detectors/" hreflang="en">${esc(w.findLink)}</a>.</p></section>
<section><h2>${esc(w.whereTitle)}</h2><ul>${w.where.map((x) => `<li>${x}</li>`).join("")}</ul></section>
<section><h2>${esc(w.privacyTitle)}</h2><ul>${w.privacy.map((x) => `<li>${x}</li>`).join("")}</ul></section>
<section id="plans"><h2>${esc(v.plansHeadline)}</h2><p>${esc(plansIntro)}${facts.trial.enabled ? ` ${esc(w.paused)}` : ""}</p>
<div class="plans">${card(v.freeName, money(0, "eur", code), v.freeNote, [v.freeB1, v.freeB2, v.freeB3, v.freeB4], false)}${card("Pro", proPrice, null, [v.proB1, v.proB2, v.proB3, v.proB4], true)}${card("Business", bizPrice, null, [v.bizB1, v.bizB2, v.bizB3, v.bizB4], false)}</div>
<p class="note">${esc(w.vat)}</p><p><a class="button" href="/dashboard.html#plans" data-workspace-lang="${code}">${esc(w.plansCta)}</a></p></section>
<section class="faq"><h2>${esc(v.faqTitle)}</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</section>
<section><h2>${esc(w.verifyTitle)}</h2><p>${w.verify(facts.trust)}</p><p>${esc(w.winget)} <code>winget install --id AurelioAvila.Redaxa --exact</code></p></section>
<section><h2>${esc(w.moreTitle)}</h2><ul><li><a href="/detectors/" hreflang="en">What Redaxa detects</a></li><li><a href="/redact-sensitive-data-before-chatgpt.html" hreflang="en">How to redact sensitive data before ChatGPT</a></li><li><a href="/pii-redaction-browser-extension.html" hreflang="en">PII redaction browser extension</a></li><li><a href="/github.html" hreflang="en">Public repository check</a></li></ul></section>
<p class="note"><a href="/privacy.html" hreflang="en">${esc(w.footer)}</a> · © 2026 Redaxa · Aurelio Avila</p>
<script src="/lang-pref.js" defer></script><script src="/cf-beacon.js" defer></script>`;
    const graph = [
      { "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "Redaxa", url: `${ORIGIN}/`, logo: `${ORIGIN}/og-image.png` },
      { "@type": "WebPage", "@id": `${url}#page`, url, name: w.title, description: w.description, inLanguage: code, isPartOf: { "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "Redaxa", url: `${ORIGIN}/` }, about: { "@type": "SoftwareApplication", name: "Redaxa", applicationCategory: "SecurityApplication", operatingSystem: "Web, Windows, Chrome", softwareVersion: facts.version, offers: facts.app.offers.map((o) => ({ "@type": "Offer", name: o.name, price: o.price, priceCurrency: o.priceCurrency, category: o.category })) } },
      { "@type": "FAQPage", "@id": `${url}#faq`, inLanguage: code, mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    ];
    const html = pageShell({ lang: code, title: w.title, description: w.description, url, graph, body, alternates: alternates(), css: CSS })
      .replace(`<meta property="og:locale" content="${code}">`, `<meta property="og:locale" content="${ogLocale}">`)
      .replace('<meta property="og:type" content="article">', '<meta property="og:type" content="website">');
    return { path: `${code}/index.html`, url, html, code, name };
  });
  return { files, languages: LANGUAGES };
}
