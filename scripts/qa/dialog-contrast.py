# QA check, not part of npm test: needs Python Playwright (pip install playwright;
# python -m playwright install chromium) and a running preview (PROMO_PREVIEW=1 npm start).
# Example: python scripts/qa/dialog-contrast.py http://127.0.0.1:4173 %TEMP%/dialogs
"""Open the sign-up and sign-in dialogs in every theme, screenshot them and
measure text contrast against the colour actually painted behind each element.
usage: python dialogs.py <base> <out-dir> [themes]"""
import sys, asyncio, json
from playwright.async_api import async_playwright
base, out = sys.argv[1], sys.argv[2]
themes = (sys.argv[3] if len(sys.argv) > 3 else 'paper,ink,graphite,carbon,ice,amber,coral,gold,lime,emerald,teal,ocean,crimson,slate').split(',')

# Effective background: walk up until a non-transparent background colour.
CONTRAST = r"""(root) => {
  // Any CSS colour (rgb, color(), oklab from color-mix) painted on a 1px canvas and read back.
  const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  const parse = c => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return {r, g, b, a: a / 255}; };
  const lum = ({r, g, b}) => [r, g, b].map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  const blend = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
  const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let col = {r: 255, g: 255, b: 255, a: 1}; for (const c of stack.reverse()) col = blend(c, col); return col; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
  const bad = [];
  for (const el of root.querySelectorAll('h2,p,label,span,a,button,input,small,strong')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || el.closest('[hidden]')) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el.tagName === 'INPUT';
    if (!own) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const fg = parse(cs.color); const bg = bgOf(el);
    const value = ratio(blend(fg, bg), bg);
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    if (value < (large ? 3 : 4.5)) bad.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.textContent || el.placeholder || '').trim().slice(0, 30)}" ${value.toFixed(2)}`);
  }
  for (const input of root.querySelectorAll('input:not([type=checkbox])')) {
    const r = input.getBoundingClientRect(); if (!r.width) continue;
    const border = parse(getComputedStyle(input).borderTopColor); const bg = bgOf(input.parentElement);
    const v = ratio(blend(border, bg), bg); if (v < 3) bad.push(`input border ${v.toFixed(2)}`);
  }
  return bad;
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        failures = 0
        for theme in themes:
            ctx = await b.new_context(viewport={'width': 1280, 'height': 820})
            await ctx.add_init_script("localStorage.setItem('redaxa.personal-preferences.v1', JSON.stringify({theme: '%s'}))" % theme)
            page = await ctx.new_page()
            await page.route('**/api/auth-config', lambda route: route.fulfill(status=200, content_type='application/json', body='{"configured":true}'))
            await page.goto(base + '/dashboard.html', wait_until='networkidle')
            await page.wait_for_timeout(400)
            for mode, selector in [('signup', '.ps-auth-buttons a.small-btn:not(.ghost)'), ('signin', '.ps-auth-buttons a.small-btn.ghost')]:
                await page.click(selector)
                await page.wait_for_timeout(350)
                dialog = page.locator('.ps-auth-dialog')
                await dialog.screenshot(path=f'{out}/{theme}-{mode}.png')
                bad = await page.evaluate(CONTRAST, await dialog.element_handle())
                if bad: failures += 1
                print(f'{theme:9s} {mode:6s}', 'OK' if not bad else 'LOW CONTRAST: ' + '; '.join(bad[:5]))
                await page.keyboard.press('Escape')
                await page.wait_for_timeout(250)
                if await page.locator('.ps-auth-backdrop.open').count():
                    await page.click('.ps-auth-close')
                    await page.wait_for_timeout(250)
            # Signed-in surfaces, opened directly: the account menu and the account sheet.
            await page.evaluate("() => { const a = document.querySelector('.ps-account'); a.classList.add('open'); a.querySelector('.ps-account-email').textContent = 'name@example.test'; a.querySelector('.ps-account-menu').hidden = false; }")
            menu = page.locator('.ps-account-menu')
            bad = await page.evaluate(CONTRAST, await menu.element_handle())
            await menu.screenshot(path=f'{out}/{theme}-menu.png')
            print(f'{theme:9s} menu  ', 'OK' if not bad else 'LOW CONTRAST: ' + '; '.join(bad[:5])); failures += bool(bad)
            await page.evaluate("() => { document.querySelector('.ps-account-menu').hidden = true; document.querySelector('dialog[aria-labelledby=ps-account-title]').showModal(); }")
            sheet = page.locator('dialog[aria-labelledby=ps-account-title]')
            bad = await page.evaluate(CONTRAST, await sheet.element_handle())
            await sheet.screenshot(path=f'{out}/{theme}-sheet.png')
            print(f'{theme:9s} sheet ', 'OK' if not bad else 'LOW CONTRAST: ' + '; '.join(bad[:5])); failures += bool(bad)
            await ctx.close()
        await b.close()
        sys.exit(1 if failures else 0)
asyncio.run(main())
