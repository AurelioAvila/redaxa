"""Workspace sidebar entry for the free trial, in every language and plan state, rendered in Brave.

Usage: python scripts/qa/sidebar-trial.py <base-url> <screenshot-dir>
Serve the repository root after `npm run build` (for example `python -m http.server 8791`).
The API is mocked: signed out, free (trial offered), trial used, trial running, Pro monthly,
Pro yearly and Business. Checks that the entry shows only to accounts without a plan, that the
offer is the trial button, and that its arrow never sits on a line of its own.
"""
import json, sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
base, out = sys.argv[1], sys.argv[2]
BRAVE = r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
prices = {"serverTime": "2026-10-23T08:00:00.000Z", "trialEnabled": True, "trialDays": 3, "prices": [
    {"plan": "personal", "interval": "monthly", "amount": 799, "currency": "eur", "taxBehavior": "exclusive", "perSeat": False},
    {"plan": "personal", "interval": "yearly", "amount": 7990, "currency": "eur", "taxBehavior": "exclusive", "perSeat": False},
    {"plan": "business", "interval": "monthly", "amount": 1499, "currency": "eur", "taxBehavior": "exclusive", "perSeat": True},
    {"plan": "business", "interval": "yearly", "amount": 14990, "currency": "eur", "taxBehavior": "exclusive", "perSeat": True}]}
END = "2026-10-25T08:00:00.000Z"

def billing(state, plan=None, interval=None, can=False, used=False, ends=None):
    return {"trialEnabled": True, "trialDays": 3, "trialLength": 3, "state": state, "blockedReason": "none", "plan": plan,
            "interval": interval, "trialEndsAt": ends, "currentPeriodEnd": ends, "cancelAtPeriodEnd": False,
            "canStartTrial": can, "trialUsed": used, "portalAvailable": state != "none"}

# state -> (/api/account payload or None when signed out, sidebar entry expected, trial button expected)
STATES = {
    "signed-out": (None, True, True),
    "free": ({"active": False, "status": None, "plan": None, "billing": billing("none", can=True)}, True, True),
    "trial-used": ({"active": False, "status": None, "plan": None, "billing": billing("none", used=True)}, True, False),
    "trial-running": ({"active": True, "status": "trialing", "currentPeriodEnd": END, "plan": "personal", "billing": billing("trialing", "personal", "yearly", used=True, ends=END)}, False, False),
    "monthly": ({"active": True, "status": "active", "currentPeriodEnd": END, "plan": "personal", "billing": billing("active", "personal", "monthly", ends=END)}, False, False),
    "annual": ({"active": True, "status": "active", "currentPeriodEnd": END, "plan": "personal", "billing": billing("active", "personal", "yearly", ends=END)}, False, False),
    "business": ({"active": True, "status": "active", "currentPeriodEnd": END, "plan": "business", "billing": billing("active", "business", "yearly", used=True, ends=END)}, False, False),
}

ARROW_CHECK = """() => {
  const a = document.querySelector('#side-fill-cta');
  const text = a.firstChild;
  if (!text || !a.textContent.endsWith('→')) return {arrow: false};
  const n = text.textContent.length;
  const rect = (i) => { const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1); return r.getBoundingClientRect(); };
  const arrow = rect(n - 1), word = rect(n - 3);
  return {arrow: true, sameLine: Math.abs(arrow.top - word.top) < 2, lines: Math.round(a.getBoundingClientRect().height)};
}"""

failures = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=BRAVE, headless=True)
    for lang in ("en", "it", "es", "fr", "de"):
        for state, (account, entry, trial) in STATES.items():
            for name, vp in (("desktop", {"width": 1366, "height": 900}), ("mobile", {"width": 390, "height": 844})):
                ctx = browser.new_context(viewport=vp)
                ctx.add_init_script(f"localStorage.setItem('redaxa.personal-preferences.v1', JSON.stringify({{language: '{lang}'}}))")
                page = ctx.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                def api(route, _request=None, account=account):
                    url = route.request.url
                    if "action=prices" in url:
                        return route.fulfill(status=200, content_type="application/json", body=json.dumps(prices))
                    if "/api/auth-config" in url:
                        return route.fulfill(status=200, content_type="application/json", body='{"configured":true}')
                    if "/api/auth/session" in url and account:
                        return route.fulfill(status=200, content_type="application/json", body='{"email":"qa@example.com"}')
                    if url.split("?")[0].endswith("/api/account") and account:
                        return route.fulfill(status=200, content_type="application/json", body=json.dumps(account))
                    return route.fulfill(status=401, content_type="application/json", body='{"error":"unauthorized"}')
                page.route("**/api/**", api)
                page.goto(f"{base}/dashboard.html#check")
                page.wait_for_function("!document.documentElement.hasAttribute('data-plan-loading')", timeout=15000)
                page.wait_for_timeout(400)
                shown = page.is_visible("#side-fill-cta")
                is_trial = shown and "is-trial" in (page.get_attribute("#side-fill-cta", "class") or "")
                label = page.inner_text("#side-fill-cta") if shown else ""
                geo = page.evaluate(ARROW_CHECK) if shown else {}
                # Phones show only the trial offer in the top strip; "Compare plans" stays in the nav there.
                want = entry and (name == "desktop" or trial)
                ok = shown == want and is_trial == trial and (not shown or (geo.get("arrow") and geo.get("sameLine"))) and not errors
                print(f"{'ok  ' if ok else 'FAIL'} {lang} {state:13} {name:7} entry={shown} trial={is_trial} label={label!r} geo={geo} errors={errors}")
                if not ok:
                    failures.append((lang, state, name))
                if state == "free" and shown:
                    page.locator(".side" if name == "desktop" else "#side-fill").screenshot(path=f"{out}/redaxa-sidebar-{lang}-{name}.png")
                ctx.close()
    browser.close()
print("FAILURES:", failures if failures else "none")
sys.exit(1 if failures else 0)
