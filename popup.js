// popup.js — management UI for watchlist, alerts, settings

const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Tab switching ─────────────────────────────────────────────────────────────
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('panel-' + btn.dataset.panel).classList.add('active');
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtNum = (n, locale = 'en-IN') => n == null ? '—' : n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const tagClass = t => ({ EQUITY:'equity', INDEX:'index', CRYPTOCURR:'crypto', ETF:'etf' }[(t||'').toUpperCase()] || 'other');

function sendMsg(msg) {
  return new Promise((res, rej) => chrome.runtime.sendMessage(msg, r => {
    if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
    if (!r?.ok) return rej(new Error(r?.error || 'Error'));
    res(r.data);
  }));
}

// ── Storage helpers ───────────────────────────────────────────────────────────
const getStorage = keys => new Promise(res => chrome.storage.local.get(keys, res));
const setStorage = data  => new Promise(res => chrome.storage.local.set(data, res));

// ── Watchlist ─────────────────────────────────────────────────────────────────
let watchlistQuotes = {};

async function loadWatchlist() {
  const { watchlist = [{ symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE India' }] } = await getStorage('watchlist');
  if (watchlist.length) {
    try {
      const quotes = await sendMsg({ type: 'GET_QUOTES', symbols: watchlist.map(w => w.symbol) });
      watchlistQuotes = quotes;
    } catch (_) {}
  }
  renderWatchlist(watchlist);
}

function renderWatchlist(watchlist) {
  const el = $('watchlist-items');
  if (!watchlist.length) { el.innerHTML = '<div class="empty">Your watchlist is empty</div>'; return; }
  el.innerHTML = watchlist.map((w, i) => {
    const q    = watchlistQuotes[w.symbol];
    const price = q ? fmtNum(q.price) : '—';
    return `
      <div class="watch-item">
        <div>
          <div class="watch-sym">${escHtml(w.symbol)}</div>
          <div style="color:#484f58;font-size:10px">${escHtml(w.name)}</div>
        </div>
        <div class="watch-price">${price}</div>
        <button class="watch-del" data-i="${i}" title="Remove">×</button>
      </div>`;
  }).join('');
  el.querySelectorAll('.watch-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { watchlist: wl = [] } = await getStorage('watchlist');
      wl.splice(+btn.dataset.i, 1);
      await setStorage({ watchlist: wl });
      loadWatchlist();
    });
  });
}

// Watchlist search
let watchSearchTimer = null;
$('watch-input').addEventListener('input', () => {
  clearTimeout(watchSearchTimer);
  const q = $('watch-input').value.trim();
  if (!q) { $('watch-results').style.display = 'none'; return; }
  watchSearchTimer = setTimeout(async () => {
    try {
      const results = await sendMsg({ type: 'SEARCH_YF', query: q });
      if (!results?.length) { $('watch-results').style.display = 'none'; return; }
      $('watch-results').style.display = 'block';
      $('watch-results').innerHTML = results.map(r => `
        <div class="sr-item" data-sym="${escHtml(r.symbol)}" data-name="${escHtml(r.name)}" data-exch="${escHtml(r.exchange)}">
          <span class="sr-sym">${escHtml(r.symbol)}</span>
          <span class="sr-name">${escHtml(r.name)}</span>
          <span class="sr-tag ${tagClass(r.type)}">${escHtml(r.type || '—')}</span>
        </div>`).join('');
      $('watch-results').querySelectorAll('.sr-item').forEach(item => {
        item.addEventListener('click', async () => {
          const { watchlist: wl = [] } = await getStorage('watchlist');
          const entry = { symbol: item.dataset.sym, name: item.dataset.name, exchange: item.dataset.exch };
          if (!wl.find(w => w.symbol === entry.symbol)) {
            wl.push(entry);
            await setStorage({ watchlist: wl });
          }
          $('watch-input').value = '';
          $('watch-results').style.display = 'none';
          loadWatchlist();
        });
      });
    } catch (_) {}
  }, 280);
});

// ── Alerts ────────────────────────────────────────────────────────────────────
async function loadAlerts() {
  const { alerts = [], n50ticker } = await getStorage(['alerts', 'n50ticker']);
  if (n50ticker?.symbol) $('alert-sym').value = n50ticker.symbol;
  if (!alerts.length) { $('alerts-items').innerHTML = '<div class="empty">No alerts set</div>'; return; }
  $('alerts-items').innerHTML = alerts.map((a, i) => `
    <div class="alert-item">
      <div class="alert-sym">${escHtml(a.symbol)}</div>
      <div class="alert-desc">${a.direction === 'above' ? '≥' : '≤'} ${a.target}</div>
      <button class="alert-del" data-i="${i}" title="Delete">×</button>
    </div>`).join('');
  $('alerts-items').querySelectorAll('.alert-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { alerts: al = [] } = await getStorage('alerts');
      al.splice(+btn.dataset.i, 1);
      await setStorage({ alerts: al });
      loadAlerts();
    });
  });
}

$('save-alert').addEventListener('click', async () => {
  const sym    = $('alert-sym').value.trim().toUpperCase();
  const dir    = $('alert-dir').value;
  const target = parseFloat($('alert-target').value);
  if (!sym || !target) return;
  const { alerts: al = [] } = await getStorage('alerts');
  al.push({ id: Date.now(), symbol: sym, direction: dir, target });
  await setStorage({ alerts: al });
  $('alert-target').value = '';
  loadAlerts();
});

// ── Settings ──────────────────────────────────────────────────────────────────
// Show platform-correct shortcut
const isMac = navigator.platform.toUpperCase().includes('MAC');
const kbdEl = document.getElementById('shortcut-display');
if (kbdEl) kbdEl.textContent = isMac ? '⌘ Shift M' : 'Alt M';
async function loadSettings() {
  const { n50theme, n50snap, n50autodetect } = await getStorage(['n50theme', 'n50snap', 'n50autodetect']);
  $('toggle-theme').checked      = n50theme === 'light';
  $('toggle-snap').checked       = n50snap !== false;
  $('toggle-autodetect').checked = n50autodetect !== false;
}

$('toggle-theme').addEventListener('change', () => setStorage({ n50theme: $('toggle-theme').checked ? 'light' : 'dark' }));
$('toggle-snap').addEventListener('change',  () => setStorage({ n50snap:  $('toggle-snap').checked }));
$('toggle-autodetect').addEventListener('change', () => setStorage({ n50autodetect: $('toggle-autodetect').checked }));

// ── Init ──────────────────────────────────────────────────────────────────────
loadWatchlist();
loadAlerts();
loadSettings();
