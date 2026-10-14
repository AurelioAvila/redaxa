"""End-to-end check of the packaged Chrome extension in a real browser.

Loads the staged extension (what the store receives) into a fresh, temporary
browser profile and drives it on local stand-ins for the four AI sites, built
from their live composer and Send-button structure. Every value is fictional.

    python scripts/qa/extension-e2e.py <staged extension dir> [--browser <exe>] [--shots <dir>]

Checks: welcome tab, popup example, automatic check on Enter and on Send in
each site shape, Escape / replace / send anyway, manual check, the off
switch (also in a tab that is already open), Italian interface,
20,000-character prompt timing, that the content script cannot read
extension storage, and that free checks make no network request (the
worker's fetch is recorded) while the account API still answers the
extension over CORS without host permissions.

Waits target the element a step produces (the result dialog's Replace button,
not any dialog): a check slower than 300 ms first shows a "Checking" dialog,
which a generic wait mistook for the result on a busy machine. Timing limits
leave room for a loaded machine; the engine's own budget is asserted in
browser-extension/detection.test.mjs.
"""
import argparse, atexit, json, pathlib, shutil, sys, tempfile, time
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("extension")
# Branded Chrome ignores --load-extension since 137; Brave or Chromium load it.
parser.add_argument("--browser", default=r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe")
parser.add_argument("--shots")
args = parser.parse_args()
ext = str(pathlib.Path(args.extension).resolve())
shots = pathlib.Path(args.shots) if args.shots else None

EXAMPLE = ("Here is our config: OPENAI_API_KEY=sk-proj-Example0nly1234567890Demo. "
           "Please email the invoice to taylor@example.com and charge card 4111 1111 1111 1111.")
CLEAN = "Summarize these meeting notes in three short bullet points."

# Composer and Send button as the live sites ship them (11 October 2026).
SHAPES = {
    "chatgpt.com": ('<textarea id="mobile-composer-prompt" rows="3"></textarea>',
                    '<button data-composer-submit aria-label="Send message" data-stop-label="Stop generating">↑</button>'),
    "claude.ai": ('<div class="ProseMirror" contenteditable="true"></div>',
                  '<button data-testid="chat-input-send" aria-label="Send message">↑</button>'),
    "gemini.google.com": ('<rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea>',
                          '<div class="send-button"><button aria-label="Send message">➤</button></div>'),
    "www.perplexity.ai": ('<div id="ask-input" contenteditable="true"></div>',
                          '<button aria-label="Submit"><svg width="16" height="16"><use xlink:href="#pplx-icon-arrow-right"></use></svg></button>'),
}

def site_html(host):
    composer, button = SHAPES[host]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{host} stand-in</title>
<style>body{{font:15px system-ui;margin:0;background:#fff;color:#222}}main{{max-width:760px;margin:40px auto}}
#log p{{background:#f3f3f3;border-radius:12px;padding:10px 14px}}textarea,[contenteditable]{{display:block;width:100%;min-height:60px;border:1px solid #ccc;border-radius:16px;padding:12px;box-sizing:border-box}}
button{{margin-top:8px}}</style></head><body><main><div id="log"></div>{composer}{button}</main>
<script>
window.__sent = [];
const box = document.querySelector('textarea, [contenteditable]');
const read = () => 'value' in box ? box.value : box.innerText;
function send() {{ const text = read().trim(); if (!text) return; __sent.push(text); const p = document.createElement('p'); p.textContent = text; document.getElementById('log').append(p); if ('value' in box) box.value = ''; else box.textContent = ''; }}
box.addEventListener('keydown', e => {{ if (e.key === 'Enter' && !e.shiftKey) {{ e.preventDefault(); send(); }} }});
document.querySelector('button').addEventListener('click', send);
</script></body></html>"""

WAIT = 15000  # ms for one step on a busy machine
failures = []
def check(ok, label):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok: failures.append(label)

def type_into(page, text):
    page.focus("textarea, [contenteditable]")
    page.keyboard.insert_text(text)

def composer_text(page):
    return page.evaluate("() => { const b = document.querySelector('textarea, [contenteditable]'); return ('value' in b ? b.value : b.innerText).trim(); }")

def sent(page):
    return page.evaluate("() => window.__sent")

def run(lang):
    profile = tempfile.mkdtemp(prefix="rdx-e2e-")
    atexit.register(shutil.rmtree, profile, ignore_errors=True)  # the browser holds it until it closes
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile, executable_path=args.browser, headless=True,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}", f"--lang={lang}",
                  "--disable-features=DisableLoadExtensionCommandLineSwitch"],
            viewport={"width": 1280, "height": 800}, locale=lang)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=20000)
        ext_id = worker.url.split("/")[2]
        # Record every request the worker makes from here on.
        worker.evaluate("() => { globalThis.__calls = []; const f = globalThis.fetch; globalThis.fetch = (...a) => { globalThis.__calls.push(String(a[0])); return f(...a); }; }")
        page_requests = []
        context.on("request", lambda r: page_requests.append(r.url))
        def stand_in(host):
            return lambda route: route.fulfill(status=200, content_type="text/html", body=site_html(host))
        for host in SHAPES:
            context.route(f"https://{host}/**", stand_in(host))

        # Welcome tab on first install. The extension opens it while Playwright
        # is still attaching, so it can be missing from context.pages for good
        # (the old flaky failure): the browser's own target list is the evidence,
        # and the flow below runs on that page or, if unattached, a fresh copy.
        deadline = time.time() + 30
        opened = None
        while time.time() < deadline and not opened:
            cdp = context.new_cdp_session(context.pages[0])
            opened = next((t for t in cdp.send("Target.getTargets")["targetInfos"] if t["type"] == "page" and "popup.html?welcome" in t["url"]), None)
            cdp.detach()
            if not opened: time.sleep(0.2)
        check(opened is not None, f"[{lang}] welcome tab opens on install")
        welcome = next((pg for pg in context.pages if "popup.html?welcome" in pg.url), None)
        if welcome is None:
            welcome = context.new_page(); welcome.goto(f"chrome-extension://{ext_id}/popup.html?welcome")
        if lang != "en":
            popup = context.new_page(); popup.goto(f"chrome-extension://{ext_id}/popup.html")
            check(popup.inner_text("#check-button").startswith("Controlla"), f"[{lang}] popup is translated")
            check(popup.evaluate("document.documentElement.lang") == "it", f"[{lang}] document language")
            site = context.new_page(); site.goto("https://chatgpt.com/")
            site.wait_for_selector("#redaxa-check-btn")
            check(site.inner_text("#redaxa-check-btn") == "Controlla con Redaxa", f"[{lang}] page button is translated")
            type_into(site, EXAMPLE); site.keyboard.press("Enter")
            site.wait_for_selector("#ps-int-fix", timeout=WAIT)
            title = site.inner_text("#ps-int-title")
            check(title.startswith("Trovati 3 elementi"), f"[{lang}] dialog title is Italian ({title})")
            check("Numero di carta" in site.inner_text("#redaxa-intercept"), f"[{lang}] finding labels are Italian")
            if shots: site.screenshot(path=str(shots / "e2e-it-chatgpt-dialog.png"))
            context.close(); return

        welcome.wait_for_selector("#welcome:not([hidden])")
        check(welcome.is_visible("#step-enable.done"), "welcome step 1 done (automatic checks on)")
        welcome.click("#try-example")
        check(welcome.is_visible("#step-example.done"), "welcome step 2 done after the example")
        welcome.click("#check-button")
        welcome.wait_for_selector("#check-result:not([hidden])")
        check(welcome.is_visible("#step-result.done"), "welcome step 3 done after the result")
        heading = welcome.inner_text("#result-heading")
        items = welcome.inner_text("#finding-list")
        check(heading == "Potential credentials found", f"welcome result heading ({heading})")
        check("OpenAI (probable)" in items and "Email address" in items and "Card number" in items, "welcome result lists key, email and card")
        redacted = welcome.input_value("#redacted-text")
        check("[SECRET]" in redacted and "[EMAIL]" in redacted and "[CARD]" in redacted and "taylor@" not in redacted, "redacted version")
        if shots: welcome.screenshot(path=str(shots / "e2e-welcome.png"), full_page=True)

        for host in SHAPES:
            page = context.new_page()
            page.goto(f"https://{host}/")
            page.wait_for_selector("#redaxa-check-btn")
            # a) clean prompt: sent straight away, no dialog.
            type_into(page, CLEAN)
            start = time.perf_counter(); page.keyboard.press("Enter")
            page.wait_for_function("() => window.__sent.length === 1", timeout=WAIT)
            elapsed = (time.perf_counter() - start) * 1000
            check(not page.is_visible("#redaxa-intercept"), f"{host}: clean prompt sent without a dialog ({elapsed:.0f} ms)")
            check(sent(page) == [CLEAN], f"{host}: clean prompt reached the site unchanged")
            # b) sensitive prompt on Enter: held, labelled dialog, focus on the safe action, Escape keeps it unsent.
            type_into(page, EXAMPLE); page.keyboard.press("Enter")
            page.wait_for_selector("#redaxa-intercept [role=dialog][aria-modal=true] #ps-int-fix", timeout=WAIT)
            check(page.inner_text("#ps-int-title") == "Found 3 items before sending", f"{host}: dialog title")
            check(page.evaluate("document.activeElement?.id") == "ps-int-fix", f"{host}: focus on Replace")
            marks = page.eval_on_selector_all(".ps-preview mark", "m => m.map(x => x.textContent)")
            check(marks == ["[SECRET]", "[EMAIL]", "[CARD]"], f"{host}: redacted preview marks {marks}")
            check("taylor@example.com" not in page.inner_html("#redaxa-intercept"), f"{host}: dialog shows no detected value")
            if shots and host == "claude.ai": page.screenshot(path=str(shots / "e2e-claude-dialog.png"))
            page.keyboard.press("Escape")
            check(not page.is_visible("#redaxa-intercept") and len(sent(page)) == 1, f"{host}: Escape closes and nothing is sent")
            check(composer_text(page) == EXAMPLE, f"{host}: prompt kept after Escape")
            # c) replace with the redacted version, then send it.
            page.focus("textarea, [contenteditable]"); page.keyboard.press("Enter")
            page.wait_for_selector("#ps-int-fix"); page.click("#ps-int-fix")
            page.wait_for_timeout(500)
            text = composer_text(page)
            check("[SECRET]" in text and "[EMAIL]" in text and "[CARD]" in text and "sk-proj" not in text, f"{host}: composer holds the redacted version")
            check(len(sent(page)) == 1, f"{host}: replacing does not send")
            page.focus("textarea, [contenteditable]"); page.keyboard.press("End"); page.keyboard.press("Enter")
            page.wait_for_function("() => window.__sent.length === 2", timeout=WAIT)
            check("[SECRET]" in sent(page)[1], f"{host}: redacted version sent on the next Enter")
            # d) Send button click is held too; Send anyway sends the reviewed text.
            type_into(page, "Reach me at maria.rossi@example.org")
            page.click("main button")
            page.wait_for_selector("#ps-int-send-anyway")
            check(len(sent(page)) == 2, f"{host}: Send click is held")
            page.click("#ps-int-send-anyway")
            page.wait_for_function("() => window.__sent.length === 3", timeout=WAIT)
            check(sent(page)[2] == "Reach me at maria.rossi@example.org", f"{host}: Send anyway sends the reviewed text")
            # e) manual check button.
            type_into(page, "Card 5500 0000 0000 0004")
            page.click("#redaxa-check-btn")
            page.wait_for_selector("#redaxa-panel.open .ps-where")
            body = page.inner_text("#redaxa-body")
            check("Card number" in body and "Checked on this device. Nothing was sent." in body, f"{host}: manual check runs locally")
            page.click("#redaxa-close")
            page.evaluate("() => { const b = document.querySelector('textarea, [contenteditable]'); if ('value' in b) b.value = ''; else b.textContent = ''; }")
            if shots and host == "chatgpt.com":
                type_into(page, EXAMPLE); page.keyboard.press("Enter"); page.wait_for_selector("#ps-int-fix")
                page.screenshot(path=str(shots / "e2e-chatgpt-dialog.png")); page.keyboard.press("Escape")
            page.close()

        # 20,000 characters: still a single quick check, editor not blocked.
        page = context.new_page(); page.goto("https://chatgpt.com/"); page.wait_for_selector("#redaxa-check-btn")
        long_text = ("Quarterly planning notes, owners and next steps for the platform team. " * 300)[:19940] + " taylor@example.com"
        page.evaluate("t => { const b = document.querySelector('textarea'); b.value = t; }", long_text)
        page.focus("textarea"); start = time.perf_counter(); page.keyboard.press("Enter")
        page.wait_for_selector("#ps-int-fix")
        elapsed = (time.perf_counter() - start) * 1000
        check(elapsed < 2500, f"20,000-character prompt checked in {elapsed:.0f} ms (dialog shown)")
        typing = page.evaluate("""() => { const t0 = performance.now(); for (let i = 0; i < 200; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); return performance.now() - t0; }""")
        check(typing < 150, f"200 ordinary keystrokes handled in {typing:.1f} ms")
        page.keyboard.press("Escape")
        # Over the limit: said plainly, and free use can still send without a check.
        page.evaluate("t => { const b = document.querySelector('textarea'); b.value = t; }", "y" * 20100)
        page.focus("textarea"); page.keyboard.press("Enter")
        page.wait_for_selector("#ps-int-send-unchecked")
        check(page.inner_text("#ps-int-title") == "Too long to check", "over 20,000 characters: explained, not stuck")
        for _ in range(3): page.keyboard.press("Tab")
        check(page.evaluate("() => document.getElementById('redaxa-intercept').contains(document.activeElement)"), "Tab stays inside the dialog")
        before = len(sent(page)); page.click("#ps-int-send-unchecked")
        page.wait_for_function(f"() => window.__sent.length === {before + 1}", timeout=WAIT)
        check(True, "free use can send an over-limit prompt without a check")
        page.close()

        # The content script runs in the AI site's process: it must not reach
        # extension storage, where a signed-in session would live.
        page = context.new_page()
        cdp = context.new_cdp_session(page); worlds = []
        cdp.on("Runtime.executionContextCreated", lambda e: worlds.append(e["context"]))
        cdp.send("Runtime.enable")
        page.goto("https://gemini.google.com/"); page.wait_for_selector("#redaxa-check-btn")
        isolated = next((c["id"] for c in worlds if c.get("auxData", {}).get("type") == "isolated" and "Redaxa" in c.get("name", "")), None)
        probe = cdp.send("Runtime.evaluate", {"contextId": isolated, "awaitPromise": True, "returnByValue": True,
            "expression": "chrome.storage.local.get(null).then(v => 'read ' + Object.keys(v).join(','), e => 'blocked: ' + e.message)"}) if isolated else {}
        result = probe.get("result", {}).get("value", "")
        check(result.startswith("blocked"), f"content script cannot read extension storage ({result or 'no isolated world'})")
        cdp.detach()

        # Off switch, set the way the popup sets it: in a tab already open, then in a new one.
        worker.evaluate("() => chrome.storage.local.set({ redaxa_auto_check: false })")
        page.wait_for_timeout(500)
        type_into(page, EXAMPLE); page.keyboard.press("Enter")
        page.wait_for_function("() => window.__sent.length === 1", timeout=WAIT)
        check(not page.is_visible("#redaxa-intercept"), "automatic check off in an open tab: Enter sends without a check")
        page.close()
        page = context.new_page(); page.goto("https://claude.ai/"); page.wait_for_selector("#redaxa-check-btn")
        type_into(page, EXAMPLE); page.keyboard.press("Enter")
        page.wait_for_function("() => window.__sent.length === 1", timeout=WAIT)
        check(not page.is_visible("#redaxa-intercept"), "automatic check off: Enter sends without a check")
        worker.evaluate("() => chrome.storage.local.set({ redaxa_auto_check: true })")
        page.close()

        # Popup at its real width.
        popup = context.new_page(); popup.set_viewport_size({"width": 380, "height": 760})
        popup.goto(f"chrome-extension://{ext_id}/popup.html")
        popup.wait_for_selector("#check-access")
        check(popup.inner_text("#check-access") == "Free and unlimited. No account needed.", "popup: free access line")
        check(popup.evaluate("document.documentElement.scrollWidth <= 380"), "popup: no horizontal overflow at 380 px")
        popup.wait_for_timeout(300)
        check(popup.is_visible("#review-ask"), "review link offered after three helpful checks")
        if shots: popup.screenshot(path=str(shots / "e2e-popup.png"), full_page=True)
        stored = worker.evaluate("() => chrome.storage.local.get(null)")
        check(set(stored) <= {"redaxa_auto_check", "redaxa_helpful_checks", "redaxa_review_prompt"}, f"storage holds settings and counters only: {sorted(stored)}")
        check(stored.get("redaxa_helpful_checks", 0) >= 3, "helpful-check counter counted AI-site findings")
        popup.reload(); popup.wait_for_selector("#check-access"); popup.wait_for_timeout(300)
        check(not popup.is_visible("#review-ask"), "review link shown only once")
        popup.close()

        # Privacy: free checks sent nothing; pages only talked to their own (stand-in) origins.
        calls = worker.evaluate("() => globalThis.__calls")
        check(calls == [], f"no worker request during free checks: {calls}")
        foreign = sorted({u.split('/')[2] for u in page_requests if u.startswith("http") and u.split('/')[2] not in SHAPES})
        check(foreign == [], f"pages made no request outside the AI sites: {foreign}")
        # Account API reachable without host permission (CORS for extension origins).
        cors = worker.evaluate("""async () => { const r = await fetch('https://redaxa.getcertsprint.com/api/account', { headers: { Authorization: 'Bearer invalid' } }); return [r.status, await r.json()]; }""")
        check(cors == [401, {"error": "UNAUTHORIZED"}], f"account API answers the extension over CORS: {cors}")
        context.close()

run("en")
run("it")
print(json.dumps({"failures": failures}))
sys.exit(1 if failures else 0)
