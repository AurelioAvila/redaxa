(() => {
  const prompt = document.querySelector('#prompt');
  const findings = document.querySelector('#findings');
  const safe = document.querySelector('#safe');
  const redacted = document.querySelector('#redacted');
  const count = document.querySelector('#risk-count');
  const title = document.querySelector('#risk-title');
  const copy = document.querySelector('#risk-copy');
  const historyRoot = document.querySelector('#history');
  const key = 'promptshield.personal-history.v1';
  const rules = [
    ['Email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]'],
    ['Phone number', /(?<!\w)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)?\d{3,4}[ .-]\d{3,4}(?!\w)/g, '[PHONE]'],
    ['API key or token', /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[\w-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g, '[SECRET]'],
    ['Card number', /\b(?:\d[ -]*?){13,16}\b/g, '[CARD]'],
    ['IPv4 address', /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '[IP ADDRESS]'],
    ['IBAN', /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, '[IBAN]'],
    ['Italian fiscal code', /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, '[FISCAL CODE]'],
    ['Password or credential', /\b(password|passwd|pwd|secret)\s*([:=])\s*([^\s,;]{6,})/gi, '$1$2[REDACTED]']
  ];
  const escape = value => value.replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
  const getHistory = () => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  function renderHistory() { const entries = getHistory(); historyRoot.innerHTML = entries.length ? entries.map(item => `<article class="entry"><strong>${item.findings} item${item.findings === 1 ? '' : 's'} reviewed</strong><span>${escape(item.preview)}</span><em>${new Date(item.createdAt).toLocaleString()}</em></article>`).join('') : '<div class="entry"><strong>No checks yet</strong><span>Your last eight check summaries will appear here.</span></div>'; }
  function scan() { const text = prompt.value; if (!text.trim()) return; let matches = [], clean = text; rules.forEach(([label, pattern, token]) => { [...text.matchAll(pattern)].forEach(match => matches.push({label,value:match[0]})); clean = clean.replace(pattern, token); }); count.textContent = String(matches.length); title.textContent = matches.length ? `${matches.length} item${matches.length === 1 ? '' : 's'} to review` : 'Nothing obvious found'; copy.textContent = matches.length ? 'Review these before sharing your prompt.' : 'This is a helpful signal, not a guarantee.'; findings.className = 'findings'; findings.innerHTML = matches.length ? matches.map(item => `<div class="finding"><i></i><div><b>${item.label}</b><span>${escape(item.value)}</span></div></div>`).join('') : '<div class="empty">No common secrets or personal details were detected.</div>'; redacted.textContent = clean; safe.style.display = 'block'; const next = [{findings:matches.length,preview:text.replace(/\s+/g,' ').slice(0,76),createdAt:new Date().toISOString()},...getHistory()].slice(0,8); localStorage.setItem(key,JSON.stringify(next)); renderHistory(); }
  document.querySelector('#scan').addEventListener('click',scan); document.querySelector('#sample').addEventListener('click',()=>{prompt.value='Send a project update to maria.rossi@example.com. The test server is 192.168.1.20 and the temporary key is sk-demoKey12345678901234567890.';scan()}); document.querySelector('#copy').addEventListener('click',async()=>{await navigator.clipboard.writeText(redacted.textContent);document.querySelector('#copy').textContent='Copied';setTimeout(()=>document.querySelector('#copy').textContent='Copy safer prompt',1400)});renderHistory();
})();
