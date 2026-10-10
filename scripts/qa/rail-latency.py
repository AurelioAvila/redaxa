# QA check, not part of npm test: needs Python Playwright and a running preview.
# Example: python scripts/qa/rail-latency.py http://127.0.0.1:4173
"""Rail click latency, measured three ways (Chromium, the WebView2 engine):
  event  = Event Timing API duration of the real (trusted) click: input -> next paint
  paint  = click -> first frame after the view is shown
  stable = click -> no running animations on the page and one more frame
usage: python latency.py <base> [label]"""
import sys, asyncio, statistics
from playwright.async_api import async_playwright
base = sys.argv[1]
label = sys.argv[2] if len(sys.argv) > 2 else base
SETUP = """() => { window.__ev = []; new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.name === 'click' || e.name === 'pointerup') window.__ev.push(e.duration); }).observe({type: 'event', durationThreshold: 16, buffered: false});
  window.__mark = () => { const t0 = performance.now(); window.__res = null;
    requestAnimationFrame(() => setTimeout(() => { const paint = performance.now() - t0;
      const wait = () => { if (document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().endTime !== Infinity)) return requestAnimationFrame(wait);
        requestAnimationFrame(() => { window.__res = {paint, stable: performance.now() - t0}; }); };
      wait(); }, 0)); };
  document.addEventListener('pointerdown', () => window.__mark(), true); }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(viewport={'width': 1280, 'height': 820}, bypass_csp=True)
        await page.goto(base + '/dashboard.html', wait_until='networkidle')
        await page.wait_for_timeout(800)
        await page.evaluate(SETUP)
        rows = {}
        for _ in range(4):
            for nav in ['activity', 'terms', 'settings', 'plans', 'account', 'check']:
                await page.click(f'.side [data-nav="{nav}"]')
                await page.wait_for_function('window.__res !== null', timeout=5000)
                res = await page.evaluate('window.__res')
                rows.setdefault(nav, []).append(res)
                await page.wait_for_timeout(120)
        events = await page.evaluate('window.__ev')
        print(label)
        for nav, values in rows.items():
            print(f'  {nav:9s} paint {statistics.median(v["paint"] for v in values):6.1f} ms   stable {statistics.median(v["stable"] for v in values):6.1f} ms')
        print(f'  event timing (click/pointerup entries >16 ms): {len(events)}' + (f', median {statistics.median(events):.0f} ms, max {max(events):.0f} ms' if events else ''))
        await b.close()
asyncio.run(main())
