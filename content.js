;(function () {
  'use strict';

  if (document.getElementById('__n50_host__')) return;
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

  // ─── Constants ───────────────────────────────────────────────────────────────
  const PW     = 520;
  const CH     = 260;   // chart canvas CSS height (includes volume area)
  const VOL_H  = 48;    // volume bars height at bottom of canvas
  const DPR    = window.devicePixelRatio || 1;
  const PAD    = { t: 10, r: 12, b: 34, l: 72 };

  // ─── State ───────────────────────────────────────────────────────────────────
  let ticker      = { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE India' };
  let currency    = 'INR';
  let activeRange = '1D';
  let pts         = [];       // [{ts, price, open, high, low, volume}]
  let prevClose   = 0;
  let isGreen     = true;
  let hoverIdx    = null;
  let isDragging  = false;
  let dragStart, hostOrigin;
  let mode        = 'full';
  let theme       = 'dark';
  let isHidden    = false;
  let activeTab   = 'chart';
  let watchlist   = [{ symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE India' }];
  let watchIdx    = 0;
  let statsCache  = {};
  let newsCache   = {};
  let alerts      = [];
  let snapEnabled = true;
  let cornerTimer = null;
  let hideTimer   = null;
  let marketState = 'CLOSED';
  let prePostPrice = null;
  let prePostPct   = null;
  let lastLoadTime = 0;  // ms timestamp of last successful chart fetch

  // ─── Shadow host ─────────────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.id    = '__n50_host__';
  Object.assign(host.style, { position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647', userSelect: 'none' });
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  // ─── CSS ─────────────────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :host {
      --bg: #0d1117; --surface: #161b22; --surface2: #1c2128;
      --text: #e6edf3; --text2: #7d8590; --text3: #484f58;
      --border: rgba(255,255,255,0.09); --border2: rgba(255,255,255,0.06);
      --green: #00d4aa; --red: #ff4757;
    }
    :host(.light) {
      --bg: #ffffff; --surface: #f6f8fa; --surface2: #eaeef2;
      --text: #1f2328; --text2: #57606a; --text3: #8c959f;
      --border: rgba(0,0,0,0.1); --border2: rgba(0,0,0,0.06);
      --green: #1a7f64; --red: #cf222e;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Pill ── */
    .pill {
      display: flex; align-items: center; background: var(--surface);
      border: 1px solid var(--border); border-radius: 50%;
      cursor: grab; height: 36px; max-width: 36px;
      overflow: hidden; white-space: nowrap;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      transition: max-width .35s cubic-bezier(.34,1.3,.64,1), border-radius .28s, border-color .2s;
    }
    .pill:active { cursor: grabbing; }
    .wrap:hover .pill { max-width: 320px; border-radius: 24px; border-color: rgba(255,255,255,0.18); }
    .pill-face {
      flex: 0 0 36px; width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700;
      transition: flex .18s, width .18s, opacity .12s;
    }
    .wrap:hover .pill-face { flex: 0 0 0; width: 0; opacity: 0; overflow: hidden; }
    .pill-body { display: flex; align-items: center; gap: 10px; padding: 0 14px 0 0; opacity: 0; transition: opacity .2s .12s; }
    .wrap:hover .pill-body { opacity: 1; }
    .pill-label { color: var(--text2); font-size: 10px; font-weight: 700; letter-spacing: .9px; text-transform: uppercase; max-width: 95px; overflow: hidden; text-overflow: ellipsis; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text3); flex: 0 0 auto; }
    .dot.open   { background: var(--green); box-shadow: 0 0 7px rgba(0,212,170,.6); animation: blink 2s ease-in-out infinite; }
    .dot.closed { background: var(--text3); }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
    .pill-vals { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .pprice { color: var(--text); font-weight: 700; font-size: 13px; letter-spacing: -.3px; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .pchg   { font-size: 11px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .pchg.up { color: var(--green); } .pchg.down { color: var(--red); }
    .pill.mode-compact .pchg { display: none; }
    .pill.mode-mini .pill-label, .pill.mode-mini .dot, .pill.mode-mini .pchg { display: none; }

    /* ── Panel ── */
    .panel {
      position: absolute; bottom: calc(100% + 10px); right: 0; width: ${PW}px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 16px;
      overflow: hidden; box-shadow: 0 28px 72px rgba(0,0,0,.75);
      opacity: 0; transform: translateY(10px) scale(.96); pointer-events: none;
      transition: opacity .22s ease, transform .22s ease;
      font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    .panel.show      { opacity: 1; transform: translateY(0) scale(1); pointer-events: all; }
    .panel.flip      { bottom: auto; top: calc(100% + 10px); transform: translateY(-10px) scale(.96); }
    .panel.flip.show { transform: translateY(0) scale(1); }
    .panel.anchor-left { right: auto; left: 0; }

    /* ── Panel header ── */
    .ph { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 14px 10px; border-bottom: 1px solid var(--border2); }
    .ph-left {}
    .ph-name-row { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; }
    .nav-btn { background: none; border: none; color: var(--text3); font-size: 16px; cursor: pointer; padding: 0 3px; line-height: 1; transition: color .15s; }
    .nav-btn:hover { color: var(--text); }
    .ph-name { color: var(--text3); font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    .edit-btn { background: none; border: 1px solid var(--border); color: var(--text3); border-radius: 5px; padding: 2px 6px; font-size: 10px; cursor: pointer; line-height: 1.4; transition: all .15s; }
    .edit-btn:hover { border-color: rgba(0,212,170,.4); color: var(--green); }
    .hprice  { color: var(--text); font-size: 26px; font-weight: 700; letter-spacing: -.8px; }
    .hchg    { font-size: 13px; font-weight: 600; margin-top: 3px; }
    .hchg.up { color: var(--green); } .hchg.down { color: var(--red); }
    .ext-price { font-size: 11px; font-weight: 600; margin-top: 2px; }
    .ext-price.up { color: var(--green); } .ext-price.down { color: var(--red); }
    .ph-right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
    .badge { font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; padding: 3px 9px; border-radius: 20px; }
    .badge.open   { color: var(--green); background: rgba(0,212,170,.12); border: 1px solid rgba(0,212,170,.25); }
    .badge.closed { color: var(--text2); background: rgba(125,133,144,.1);  border: 1px solid rgba(125,133,144,.22); }
    .badge.pre  { color: #f0883e; background: rgba(240,136,62,.12); border: 1px solid rgba(240,136,62,.25); }
    .badge.post { color: #d2a8ff; background: rgba(210,168,255,.12); border: 1px solid rgba(210,168,255,.25); }
    .upd { color: var(--text3); font-size: 10px; }
    .ph-actions { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .icon-btn { background: none; border: 1px solid var(--border); color: var(--text3); border-radius: 6px; padding: 3px 7px; font-size: 11px; cursor: pointer; transition: all .15s; }
    .icon-btn:hover { border-color: var(--border2); color: var(--text); background: var(--surface); }
    .icon-btn.active { color: var(--green); border-color: rgba(0,212,170,.3); }

    /* ── Tabs ── */
    .tabs { display: flex; border-bottom: 1px solid var(--border2); background: var(--bg); }
    .tab-btn { flex: 1; padding: 9px 4px; border: none; background: none; color: var(--text3); font-size: 10px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; cursor: pointer; border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; }
    .tab-btn:hover  { color: var(--text2); }
    .tab-btn.active { color: var(--text); border-bottom-color: var(--green); }

    /* ── Tab content — fixed height matching chart tab so panel never resizes ── */
    .tab-pane { display: none; }
    .tab-pane.active { display: block; height: 302px; overflow-y: auto; }
    #tab-chart { overflow: hidden; } /* chart is exact size, no scroll needed */

    /* ── Chart ── */
    .chart-wrap { position: relative; }
    canvas { display: block; }
    .spinner-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(13,17,23,.75); }
    .spinner { width: 22px; height: 22px; border: 2px solid var(--border); border-top-color: var(--green); border-radius: 50%; animation: spin .75s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .errbox { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: var(--text2); font-size: 12px; }
    .retry-btn { padding: 5px 14px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 11px; }
    .retry-btn:hover { background: var(--surface2); }
    .chart-footer { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px 8px; }
    .ranges { display: flex; gap: 4px; }
    .rb { padding: 5px 10px; border: none; border-radius: 6px; background: var(--surface); color: var(--text2); font-size: 11px; font-weight: 600; cursor: pointer; transition: background .15s, color .15s; }
    .rb:hover { background: var(--surface2); color: var(--text); }
    .rb.sel { color: var(--green); background: rgba(0,212,170,.12); }
    .rb.sel.neg { color: var(--red); background: rgba(255,71,87,.12); }
    .chart-actions { display: flex; gap: 4px; }
    .action-btn { background: none; border: none; color: var(--text3); font-size: 10px; font-weight: 600; cursor: pointer; padding: 4px 8px; border-radius: 5px; transition: all .15s; letter-spacing: .3px; }
    .action-btn:hover { color: var(--text); background: var(--surface); }
    .action-btn.ok { color: var(--green); }

    /* ── Stats tab ── */
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; background: var(--border2); gap: 1px; }
    .stat-item  { background: var(--bg); padding: 11px 14px; }
    .stat-label { color: var(--text3); font-size: 9px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; margin-bottom: 3px; }
    .stat-value { color: var(--text); font-size: 13px; font-weight: 700; }
    .stat-value.up { color: var(--green); } .stat-value.down { color: var(--red); }
    .stat-bar   { height: 3px; background: var(--surface2); border-radius: 2px; margin-top: 5px; overflow: hidden; }
    .stat-bar-fill { height: 100%; background: var(--green); border-radius: 2px; }
    .stats-loading { padding: 30px; text-align: center; color: var(--text3); font-size: 12px; }

    /* ── News tab ── */
    .news-item { display: block; padding: 10px 14px; border-bottom: 1px solid var(--border2); cursor: pointer; transition: background .1s; text-decoration: none; }
    .news-item:hover { background: var(--surface); }
    .news-title { color: var(--text); font-size: 12px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .news-meta  { color: var(--text3); font-size: 10px; margin-top: 4px; display: flex; gap: 8px; }
    .news-loading { padding: 30px; text-align: center; color: var(--text3); font-size: 12px; }

    /* ── Alerts tab ── */
    .alert-form-wrap { padding: 10px 14px; border-bottom: 1px solid var(--border2); }
    .af-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text3); margin-bottom: 7px; }
    .af-select { width: 100%; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 10px; font-size: 12px; outline: none; margin-bottom: 5px; }
    .af-row  { display: flex; gap: 5px; align-items: center; }
    .af-input { flex: 1; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 10px; font-size: 12px; outline: none; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .af-input:focus { border-color: rgba(0,212,170,.4); }
    .af-input::placeholder { color: var(--text3); }
    .af-save { padding: 6px 12px; background: var(--green); border: none; color: #0d1117; border-radius: 6px; font-weight: 700; font-size: 11px; cursor: pointer; white-space: nowrap; }
    .alert-hint { font-size: 10px; color: var(--text3); padding: 5px 14px 8px; }
    .alerts-list { overflow-y: auto; max-height: 155px; }
    .alert-item { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border2); }
    .alert-sym  { font-weight: 700; font-size: 12px; color: var(--text); min-width: 65px; }
    .alert-desc { color: var(--text2); font-size: 11px; flex: 1; }
    .alert-del  { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 16px; padding: 0 2px; transition: color .1s; }
    .alert-del:hover { color: var(--red); }
    .alerts-empty { padding: 24px; text-align: center; color: var(--text3); font-size: 12px; }

    /* ── Search overlay ── */
    .search-overlay { position: absolute; inset: 0; z-index: 20; background: var(--bg); display: flex; flex-direction: column; opacity: 0; pointer-events: none; transition: opacity .18s; }
    .search-overlay.visible { opacity: 1; pointer-events: all; }
    .search-bar { display: flex; align-items: center; gap: 8px; padding: 11px 14px 10px; border-bottom: 1px solid var(--border2); flex: 0 0 auto; }
    .search-icon { color: var(--text3); font-size: 14px; }
    .search-input { flex: 1; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 7px 11px; font-size: 13px; outline: none; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .search-input::placeholder { color: var(--text3); }
    .search-input:focus { border-color: rgba(0,212,170,.4); background: var(--surface2); }
    .search-x { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 16px; padding: 2px 4px; border-radius: 4px; }
    .search-x:hover { color: var(--text); background: var(--surface); }
    .search-results { flex: 1; overflow-y: auto; }
    .sr-hint, .sr-loading, .sr-empty { padding: 18px; text-align: center; color: var(--text3); font-size: 11px; }
    .sr-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid var(--border2); transition: background .1s; }
    .sr-item:hover { background: var(--surface); }
    .sr-sym  { color: var(--text); font-weight: 700; font-size: 13px; min-width: 80px; flex: 0 0 auto; }
    .sr-name { color: var(--text2); font-size: 12px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sr-tag  { flex: 0 0 auto; font-size: 9px; font-weight: 700; letter-spacing: .4px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .sr-tag.equity { color: #58a6ff; background: rgba(88,166,255,.1); }
    .sr-tag.index  { color: #00d4aa; background: rgba(0,212,170,.1); }
    .sr-tag.crypto { color: #f0883e; background: rgba(240,136,62,.1); }
    .sr-tag.etf    { color: #d2a8ff; background: rgba(210,168,255,.1); }
    .sr-tag.fund   { color: #56d364; background: rgba(86,211,100,.1); }
    .sr-tag.other  { color: var(--text2); background: rgba(125,133,144,.1); }
    .sr-exchange { color: var(--text3); font-size: 10px; flex: 0 0 auto; }

    /* ── Context menu ── */
    .ctx-menu { position: fixed; background: var(--surface2); border: 1px solid rgba(255,255,255,.13); border-radius: 11px; padding: 5px; box-shadow: 0 10px 36px rgba(0,0,0,.72); min-width: 170px; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; opacity: 0; transform: scale(.93) translateY(-4px); pointer-events: none; transition: opacity .14s, transform .14s; }
    .ctx-menu.show { opacity: 1; transform: scale(1) translateY(0); pointer-events: all; }
    .ctx-lbl  { font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--text3); padding: 5px 10px 3px; }
    .ctx-item { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 7px; cursor: pointer; font-size: 12px; color: #c9d1d9; transition: background .1s; }
    .ctx-item:hover { background: rgba(255,255,255,.07); }
    .ctx-check { width: 14px; font-size: 10px; color: var(--green); text-align: center; }
    .ctx-sep   { height: 1px; background: rgba(255,255,255,.07); margin: 4px 6px; }
    .ctx-item.danger { color: #ff6b7a; }
    .ctx-item.danger:hover { background: rgba(255,71,87,.1); }

    /* ── Restore button ── */
    .restore-btn { display: flex; align-items: center; overflow: hidden; white-space: nowrap; background: var(--surface); border: 2px solid var(--green); border-radius: 24px; cursor: pointer; height: 36px; max-width: 36px; box-shadow: 0 4px 18px rgba(0,0,0,.55); transition: max-width .32s cubic-bezier(.34,1.4,.64,1), box-shadow .2s, border-color .2s; }
    .restore-btn:hover { max-width: 240px; box-shadow: 0 6px 24px rgba(0,0,0,.65); }
    .restore-btn.neg { border-color: var(--red); }
    .restore-icon { width: 36px; height: 36px; flex: 0 0 36px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: var(--text); }
    .restore-info { display: flex; flex-direction: column; gap: 1px; padding: 0 12px 0 0; opacity: 0; transition: opacity .15s .08s; }
    .restore-btn:hover .restore-info { opacity: 1; }
    .restore-sym   { color: var(--text2); font-size: 9px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .restore-price { color: var(--text); font-size: 13px; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .restore-chg   { font-size: 10px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .restore-chg.up { color: var(--green); } .restore-chg.down { color: var(--red); }
  `;
  root.appendChild(styleEl);

  // ─── Markup ──────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="pill mode-full" id="pill">
      <span class="pill-face" id="pill-face">▲</span>
      <div class="pill-body">
        <span class="pill-label" id="pill-label">NIFTY 50</span>
        <span class="dot" id="dot"></span>
        <div class="pill-vals">
          <span class="pprice" id="pprice">—</span>
          <span class="pchg"   id="pchg"></span>
        </div>
      </div>
    </div>

    <div class="panel" id="panel">
      <!-- Header -->
      <div class="ph">
        <div class="ph-left">
          <div class="ph-name-row">
            <button class="nav-btn" id="prev-ticker">‹</button>
            <span class="ph-name" id="ph-name">NIFTY 50</span>
            <button class="nav-btn" id="next-ticker">›</button>
            <button class="edit-btn" id="search-btn">⌕</button>
          </div>
          <div class="hprice" id="hprice">—</div>
          <div class="hchg"   id="hchg">—</div>
          <div class="ext-price" id="ext-price" style="display:none"></div>
        </div>
        <div class="ph-right">
          <span class="badge" id="badge">—</span>
          <span class="upd"   id="upd">—</span>
          <div class="ph-actions">
            <button class="icon-btn" id="theme-btn" title="Toggle theme">☀</button>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab-btn active" data-tab="chart">Chart</button>
        <button class="tab-btn" data-tab="stats">Stats</button>
        <button class="tab-btn" data-tab="news">News</button>
        <button class="tab-btn" data-tab="alerts">Alerts</button>
      </div>

      <!-- Chart tab -->
      <div class="tab-pane active" id="tab-chart">
        <div class="chart-wrap">
          <canvas id="cv"></canvas>
          <div class="spinner-wrap" id="spin"><div class="spinner"></div></div>
          <div class="errbox" id="errbox" style="display:none">
            <span id="errmsg">Could not load data</span>
            <button class="retry-btn" id="retry">Retry</button>
          </div>
          <div class="search-overlay" id="search-overlay">
            <div class="search-bar">
              <span class="search-icon">⌕</span>
              <input class="search-input" id="search-input" placeholder="Search stocks, indices, crypto, ETFs…" autocomplete="off" spellcheck="false" />
              <button class="search-x" id="search-x">✕</button>
            </div>
            <div class="search-results" id="search-results">
              <div class="sr-hint">Type a name or symbol — e.g. AAPL, Reliance, BTC, Nifty</div>
            </div>
          </div>
        </div>
        <div class="chart-footer">
          <div class="ranges">
            <button class="rb sel" data-r="1D">1D</button>
            <button class="rb"     data-r="1W">1W</button>
            <button class="rb"     data-r="1M">1M</button>
            <button class="rb"     data-r="6M">6M</button>
            <button class="rb"     data-r="1Y">1Y</button>
            <button class="rb"     data-r="ALL">All</button>
          </div>
          <div class="chart-actions">
            <button class="action-btn" id="copy-btn">📋 Copy chart</button>
          </div>
        </div>
      </div>

      <!-- Stats tab -->
      <div class="tab-pane" id="tab-stats">
        <div id="stats-content"><div class="stats-loading">Loading stats…</div></div>
      </div>

      <!-- News tab -->
      <div class="tab-pane" id="tab-news">
        <div id="news-content"><div class="news-loading">Loading news…</div></div>
      </div>

      <!-- Alerts tab -->
      <div class="tab-pane" id="tab-alerts">
        <div class="alert-form-wrap">
          <div class="af-label">Set Price Alert for <strong id="alert-ticker-name">current ticker</strong></div>
          <select class="af-select" id="af-dir">
            <option value="above">Price goes above →</option>
            <option value="below">Price goes below ←</option>
          </select>
          <div class="af-row">
            <input class="af-input" id="af-target" type="number" placeholder="Target price" step="any" min="0" />
            <button class="af-save" id="af-save">Set Alert</button>
          </div>
        </div>
        <div class="alert-hint" id="alert-hint">Alert fires for: <strong id="alert-sym-label">—</strong></div>
        <div class="alerts-list" id="alerts-list"><div class="alerts-empty">No alerts set</div></div>
      </div>
    </div>

    <!-- Right-click context menu -->
    <div class="ctx-menu" id="ctx-menu">
      <div class="ctx-lbl">Expanded view</div>
      <div class="ctx-item" data-mode="full"><span class="ctx-check" id="chk-full">✓</span>Full</div>
      <div class="ctx-item" data-mode="compact"><span class="ctx-check" id="chk-compact"></span>Compact</div>
      <div class="ctx-item" data-mode="mini"><span class="ctx-check" id="chk-mini"></span>Mini</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" id="ctx-hide"><span class="ctx-check"></span>Hide widget</div>
    </div>
  `;
  root.appendChild(wrap);

  // Restore button
  const restoreBtn = document.createElement('button');
  restoreBtn.id = 'restore-btn'; restoreBtn.className = 'restore-btn'; restoreBtn.title = 'Show widget';
  restoreBtn.innerHTML = `<span class="restore-icon" id="r-icon">▲</span><div class="restore-info"><span class="restore-sym" id="r-sym">—</span><span class="restore-price" id="r-price">—</span><span class="restore-chg up" id="r-chg"></span></div>`;
  restoreBtn.style.display = 'none';
  root.appendChild(restoreBtn);

  // ─── DOM refs ─────────────────────────────────────────────────────────────────
  const $       = id => root.getElementById(id);
  const pill    = $('pill'), panel = $('panel'), ctxMenu = $('ctx-menu');
  const pillFace = $('pill-face'), pillLbl = $('pill-label'), dot = $('dot');
  const pprice  = $('pprice'), pchg = $('pchg');
  const phName  = $('ph-name'), hprice = $('hprice'), hchg = $('hchg');
  const badge   = $('badge'), upd = $('upd'), extPrice = $('ext-price');
  const spin    = $('spin'), errbox = $('errbox'), errmsg = $('errmsg');
  const cv      = $('cv');
  const rbtns   = root.querySelectorAll('.rb');
  const tabBtns = root.querySelectorAll('.tab-btn');
  const searchOverlay = $('search-overlay'), searchInput = $('search-input'), searchResults = $('search-results');
  const rIcon = $('r-icon'), rSym = $('r-sym'), rPrice = $('r-price'), rChg = $('r-chg');

  // ─── Canvas ───────────────────────────────────────────────────────────────────
  cv.width = PW * DPR; cv.height = CH * DPR;
  cv.style.width = PW + 'px'; cv.style.height = CH + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(DPR, DPR);

  // ─── Formatters ───────────────────────────────────────────────────────────────
  function fmtPrice(n) { return n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtBig(n) {
    if (!n) return '—';
    if (n >= 1e12) return (n/1e12).toFixed(2) + 'T';
    if (n >= 1e9)  return (n/1e9).toFixed(2) + 'B';
    if (n >= 1e7)  return (n/1e7).toFixed(2) + 'Cr';
    if (n >= 1e5)  return (n/1e5).toFixed(2) + 'L';
    return n.toLocaleString();
  }
  function fmtAxis(ts, range) {
    const d = new Date(ts), tz = { timeZone: 'Asia/Kolkata' };
    if (range === '1D') return d.toLocaleTimeString('en-IN', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false });
    if (range === '1W') return d.toLocaleDateString('en-IN', { ...tz, weekday: 'short' });
    if (range === '1M') return d.toLocaleDateString('en-IN', { ...tz, day: 'numeric', month: 'short' });
    return d.toLocaleDateString('en-IN', { ...tz, month: 'short', year: '2-digit' });
  }
  function fmtTip(ts, range) {
    const d = new Date(ts), tz = { timeZone: 'Asia/Kolkata' };
    if (range === '1D') return d.toLocaleTimeString('en-IN', { ...tz, hour: '2-digit', minute: '2-digit', hour12: true });
    return d.toLocaleDateString('en-IN', { ...tz, day: 'numeric', month: 'short', year: 'numeric' });
  }
  function timeAgo(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60)   return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function tagClass(t) { return ({ EQUITY:'equity', INDEX:'index', CRYPTOCURR:'crypto', ETF:'etf', MUTUALFUND:'fund' })[(t||'').toUpperCase()] || 'other'; }

  // ─── Mode / theme / visibility ────────────────────────────────────────────────
  function applyMode() {
    pill.className = 'pill mode-' + mode;
    ['full','compact','mini'].forEach(m => { const e=$('chk-'+m); if(e) e.textContent = m===mode?'✓':''; });
    wrap.style.display = isHidden ? 'none' : '';
    restoreBtn.style.display = isHidden ? 'flex' : 'none';
    restoreBtn.className = 'restore-btn' + (isGreen ? '' : ' neg');
    chrome.storage.local.set({ n50mode: mode, n50hidden: isHidden });
  }
  function applyTheme() {
    host.classList.toggle('light', theme === 'light');
    const btn = $('theme-btn');
    if (btn) { btn.textContent = theme === 'light' ? '🌙' : '☀'; btn.classList.toggle('active', theme === 'light'); }
    chrome.storage.local.set({ n50theme: theme });
  }
  function setMode(m) { mode = m; applyMode(); }
  function hide()    { isHidden = true;  applyMode(); }
  function restore() { isHidden = false; applyMode(); }
  function updateTickerLabels() {
    pillLbl.textContent = ticker.name || ticker.symbol;
    phName.textContent  = `${ticker.symbol} · ${ticker.exchange || ''}`;
    const an = $('alert-ticker-name'), as = $('alert-sym-label');
    if (an) an.textContent = ticker.name || ticker.symbol;
    if (as) as.textContent = ticker.symbol;
  }

  // ─── Tab switching ────────────────────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    root.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    if (tab === 'stats'     && !statsCache[ticker.symbol]) loadStats();
    if (tab === 'news'      && !newsCache[ticker.symbol])  loadNews();
    if (tab === 'alerts')    loadAlertsTab();
  }
  tabBtns.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); switchTab(b.dataset.tab); }));

  // ─── Chart renderer ───────────────────────────────────────────────────────────
  function renderChart() {
    if (!pts.length) return;
    const { t, r, b, l } = PAD;
    const chartH = CH - VOL_H;
    const aw = PW - l - r, ah = chartH - t - b;
    const prices = pts.map(p => p.price);
    const pMin = Math.min(...prices), pMax = Math.max(...prices);
    const sp = pMax - pMin || pMax * 0.005;
    const lo = pMin - sp * 0.1, hi = pMax + sp * 0.1;
    const t0 = pts[0].ts, tSpan = (pts[pts.length-1].ts - t0) || 1;

    const xOf = ts    => l + (ts - t0) / tSpan * aw;
    const yOf = price => t + ah * (1 - (price - lo) / (hi - lo));
    const color = isGreen ? '#00d4aa' : '#ff4757', colorRa = isGreen ? '0,212,170' : '255,71,87';

    // Theme-aware chart colors
    const isLight    = theme === 'light';
    const gridCol    = isLight ? 'rgba(0,0,0,0.07)'       : 'rgba(255,255,255,0.04)';
    const labelCol   = isLight ? 'rgba(0,0,0,0.45)'       : 'rgba(255,255,255,0.28)';
    const crossCol   = isLight ? 'rgba(0,0,0,0.18)'       : 'rgba(255,255,255,0.16)';
    const pcLineCol  = isLight ? 'rgba(0,0,0,0.2)'        : 'rgba(255,255,255,0.2)';
    const pcTextCol  = isLight ? 'rgba(0,0,0,0.38)'       : 'rgba(255,255,255,0.35)';
    const tipBg      = isLight ? 'rgba(240,242,245,0.97)' : 'rgba(22,27,34,0.96)';
    const tipText    = isLight ? '#1f2328'                 : '#e6edf3';
    const tipText2   = isLight ? 'rgba(0,0,0,0.4)'        : 'rgba(255,255,255,0.38)';
    const dotBorder  = isLight ? '#f6f8fa'                 : '#0d1117';
    const volCol     = isLight ? 'rgba(0,0,0,0.12)'       : 'rgba(255,255,255,0.2)';

    ctx.clearRect(0, 0, PW, CH);

    // Grid
    ctx.strokeStyle = gridCol; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = t + ah*(i/4); ctx.beginPath(); ctx.moveTo(l,y); ctx.lineTo(l+aw,y); ctx.stroke(); }

    // Y labels
    ctx.fillStyle = labelCol; ctx.font = '10px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) ctx.fillText(fmtPrice(hi-(hi-lo)*(i/4)), l-6, t+ah*(i/4)+3.5);

    // Previous close line (1D only)
    if (activeRange === '1D' && prevClose > 0) {
      const pcy = yOf(prevClose);
      if (pcy >= t && pcy <= t + ah) {
        ctx.setLineDash([3,3]); ctx.strokeStyle = pcLineCol; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(l, pcy); ctx.lineTo(l+aw, pcy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = pcTextCol; ctx.font = '9px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('PC', l+3, pcy-3);
      }
    }

    // Area fill
    const grad = ctx.createLinearGradient(0, t, 0, t+ah);
    grad.addColorStop(0, `rgba(${colorRa},0.22)`); grad.addColorStop(1, `rgba(${colorRa},0)`);
    ctx.beginPath();
    pts.forEach((p,i) => { i===0 ? ctx.moveTo(xOf(p.ts),yOf(p.price)) : ctx.lineTo(xOf(p.ts),yOf(p.price)); });
    ctx.lineTo(xOf(pts[pts.length-1].ts), t+ah); ctx.lineTo(xOf(t0), t+ah);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

    // Price line
    ctx.beginPath();
    pts.forEach((p,i) => { i===0 ? ctx.moveTo(xOf(p.ts),yOf(p.price)) : ctx.lineTo(xOf(p.ts),yOf(p.price)); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // Volume bars
    const vols = pts.map(p => p.volume || 0);
    const maxVol = Math.max(...vols) || 1;
    const volTop = t + ah + b + 4, volAreaH = VOL_H - 8;
    const barW = Math.max(1, aw / pts.length * 0.7);
    pts.forEach(p => {
      if (!p.volume) return;
      const x = xOf(p.ts), bh = (p.volume / maxVol) * volAreaH;
      ctx.fillStyle = `rgba(${colorRa},0.35)`;
      ctx.fillRect(x - barW/2, volTop + volAreaH - bh, barW, bh);
    });
    ctx.fillStyle = volCol; ctx.textAlign = 'right'; ctx.font = '9px -apple-system,system-ui,sans-serif';
    ctx.fillText('VOL', l-4, volTop + 9);

    // X labels
    ctx.fillStyle = labelCol; ctx.textAlign = 'center'; ctx.font = '10px -apple-system,system-ui,sans-serif';
    const usedX = [];
    for (let i=0; i<=5; i++) {
      const p = pts[Math.round((pts.length-1)*(i/5))], x = xOf(p.ts);
      if (usedX.every(u => Math.abs(u-x)>55)) { ctx.fillText(fmtAxis(p.ts, activeRange), x, t+ah+18); usedX.push(x); }
    }

    // Hover
    if (hoverIdx !== null) {
      const p = pts[hoverIdx], x = xOf(p.ts), y = yOf(p.price);
      ctx.setLineDash([3,4]); ctx.strokeStyle = crossCol; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x,t); ctx.lineTo(x,t+ah); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
      ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.strokeStyle=dotBorder; ctx.lineWidth=2; ctx.stroke();

      // OHLC tooltip
      const o=p.open, h2=p.high, lo2=p.low, cl=p.price;
      const ohlcStr = (o&&h2&&lo2) ? ` O:${fmtPrice(o)} H:${fmtPrice(h2)} L:${fmtPrice(lo2)}` : '';
      const ps = fmtPrice(cl), ts2 = fmtTip(p.ts, activeRange);
      const line1 = ps + '  ' + ts2, line2 = ohlcStr.trim();
      ctx.font = 'bold 11px -apple-system,system-ui,sans-serif';
      const w1 = ctx.measureText(line1).width;
      ctx.font = '9px -apple-system,system-ui,sans-serif';
      const w2 = ctx.measureText(line2).width;
      const tipW = Math.max(w1,w2) + 18, tipH = line2 ? 36 : 22;
      const tipX = Math.max(l, Math.min(l+aw-tipW, x-tipW/2)), tipY = t+4;
      ctx.fillStyle = tipBg;
      ctx.beginPath(); ctx.roundRect(tipX,tipY,tipW,tipH,5); ctx.fill();
      ctx.fillStyle = tipText; ctx.font = 'bold 11px -apple-system,system-ui,sans-serif'; ctx.textAlign='left';
      ctx.fillText(ps, tipX+9, tipY+15);
      ctx.fillStyle = tipText2; ctx.font = '10px -apple-system,system-ui,sans-serif';
      ctx.fillText(ts2, tipX+9+ctx.measureText(ps).width+5, tipY+15);
      if (line2) { ctx.fillStyle=tipText2; ctx.font='9px -apple-system,system-ui,sans-serif'; ctx.fillText(line2, tipX+9, tipY+28); }
    }
  }

  cv.addEventListener('mousemove', e => {
    if (!pts.length) return;
    const mx = e.clientX - cv.getBoundingClientRect().left;
    const aw = PW-PAD.l-PAD.r, t0=pts[0].ts, span=(pts[pts.length-1].ts-t0)||1;
    let best=0, bestD=Infinity;
    pts.forEach((p,i) => { const d=Math.abs(PAD.l+(p.ts-t0)/span*aw-mx); if(d<bestD){bestD=d;best=i;} });
    hoverIdx=best; renderChart();
  });
  cv.addEventListener('mouseleave', () => { hoverIdx=null; renderChart(); });

  // ─── Data fetching ────────────────────────────────────────────────────────────
  function sendMsg(msg) {
    return new Promise((res, rej) => chrome.runtime.sendMessage(msg, r => {
      if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
      if (!r?.ok) return rej(new Error(r?.error || 'Unknown error'));
      res(r.data);
    }));
  }

  function getChgStr(price, prev) {
    const d=price-prev, pct=(d/prev)*100, s=d>=0?'+':'';
    return { str:`${s}${fmtPrice(d)} (${s}${pct.toFixed(2)}%)`, up:d>=0 };
  }

  function applyUIData(data) {
    const { price, previousClose: pc, marketState: ms, preMarketPrice, postMarketPrice,
            preMarketChangePercent: prePct, postMarketChangePercent: postPct,
            data: points, currency: cur, exchangeName, shortName } = data;
    currency = cur || 'USD'; pts = points; prevClose = pc || 0; marketState = ms;
    if (shortName && shortName !== ticker.symbol) ticker.name = shortName;
    if (exchangeName) ticker.exchange = exchangeName;
    updateTickerLabels();

    const chg = getChgStr(price, pc);
    isGreen = chg.up;
    const ps = fmtPrice(price);
    pillFace.textContent = isGreen ? '▲' : '▼';
    pillFace.style.color = isGreen ? 'var(--green)' : 'var(--red)';
    pprice.textContent = ps; pchg.textContent = chg.str; pchg.className = 'pchg '+(isGreen?'up':'down');
    hprice.textContent = ps; hchg.textContent = chg.str; hchg.className = 'hchg '+(isGreen?'up':'down');

    // Pre/post market display
    prePostPrice = null; prePostPct = null;
    if (ms === 'PRE' && preMarketPrice)   { prePostPrice = preMarketPrice; prePostPct = prePct; }
    if (ms === 'POST' && postMarketPrice) { prePostPrice = postMarketPrice; prePostPct = postPct; }
    if (prePostPrice) {
      const ep = isGreen ? 'up' : 'down';
      extPrice.textContent = `${ms === 'PRE' ? 'Pre' : 'Post'}-market: ${fmtPrice(prePostPrice)} (${prePostPct!=null ? (prePostPct*100).toFixed(2)+'%' : ''})`;
      extPrice.className = `ext-price ${ep}`; extPrice.style.display = '';
    } else { extPrice.style.display = 'none'; }

    const stateMap = { REGULAR:'open', PRE:'pre', POST:'post', CLOSED:'closed', PREPRE:'closed' };
    const stateLabel = { REGULAR:'Market Open', PRE:'Pre-Market', POST:'After-Hours', CLOSED:'Market Closed', PREPRE:'Market Closed' };
    const sc = stateMap[ms] || 'closed';
    dot.className = 'dot '+(ms==='REGULAR'?'open':'closed');
    badge.textContent = stateLabel[ms] || 'Market Closed'; badge.className = 'badge '+sc;
    upd.textContent = 'Updated '+new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});

    rbtns.forEach(b => { const on=b.dataset.r===activeRange; b.className='rb'+(on?' sel'+(isGreen?'':' neg'):''); });
    restoreBtn.className = 'restore-btn'+(isGreen?'':' neg');
    if (rIcon) rIcon.textContent = isGreen?'▲':'▼';
    if (rSym)  rSym.textContent  = ticker.name||ticker.symbol;
    if (rPrice) rPrice.textContent = ps;
    if (rChg) { const c=getChgStr(price,pc); rChg.textContent=c.str; rChg.className='restore-chg '+(c.up?'up':'down'); }

    spin.style.display='none'; errbox.style.display='none';
    lastLoadTime = Date.now();
    renderChart();
    checkAlerts(price);
  }

  // Check alerts for current ticker on every price update — instant in-page toast
  function checkAlerts(price) {
    chrome.storage.local.get('alerts', ({ alerts: al = [] }) => {
      const triggered = [], remaining = [];
      for (const a of al) {
        const hit = a.symbol === ticker.symbol &&
          ((a.direction === 'above' && price >= a.target) ||
           (a.direction === 'below' && price <= a.target));
        hit ? triggered.push(a) : remaining.push(a);
      }
      if (!triggered.length) return;
      chrome.storage.local.set({ alerts: remaining });
      triggered.forEach(a => showAlertToast(a, price));
      if (activeTab === 'alerts') loadAlertsTab();
    });
  }

  function showAlertToast(a, price) {
    const isUp  = a.direction === 'above';
    const color = isUp ? '#00d4aa' : '#ff4757';
    const loc   = currency === 'INR' ? 'en-IN' : 'en-US';
    const fmt   = n => n.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Inject keyframes once
    if (!document.getElementById('__n50_kf__')) {
      const s = document.createElement('style');
      s.id = '__n50_kf__';
      s.textContent = `
        @keyframes n50in  { from { transform:translateX(110%); opacity:0 } to { transform:translateX(0); opacity:1 } }
        @keyframes n50out { from { transform:translateX(0); opacity:1 } to { transform:translateX(110%); opacity:0 } }
      `;
      document.head.appendChild(s);
    }

    // Stack toasts vertically
    const offset = document.querySelectorAll('[data-n50toast]').length * 88;

    const el = document.createElement('div');
    el.dataset.n50toast = '1';
    el.style.cssText = `
      position:fixed; top:${20 + offset}px; right:20px; z-index:2147483646;
      background:#161b22; border:1px solid rgba(255,255,255,0.1);
      border-left:3px solid ${color}; border-radius:10px;
      padding:12px 14px; min-width:260px; max-width:320px;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      animation:n50in 0.3s ease; cursor:pointer;
    `;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#7d8590;margin-bottom:4px">🔔 Price Alert</div>
          <div style="font-size:14px;font-weight:700;color:#e6edf3">${a.symbol}</div>
          <div style="font-size:12px;color:#7d8590;margin-top:2px">Went ${a.direction} ${fmt(a.target)}</div>
          <div style="font-size:13px;font-weight:700;color:${color};margin-top:5px">Now at ${fmt(price)}</div>
        </div>
        <button style="background:none;border:none;color:#484f58;cursor:pointer;font-size:18px;padding:0;line-height:1;flex-shrink:0">×</button>
      </div>
    `;

    const dismiss = () => {
      el.style.animation = 'n50out 0.25s ease forwards';
      setTimeout(() => el.remove(), 260);
    };
    el.querySelector('button').addEventListener('click', e => { e.stopPropagation(); dismiss(); });
    el.addEventListener('click', dismiss);
    setTimeout(dismiss, 6000);

    document.body.appendChild(el);
  }

  async function loadData(range) {
    spin.style.display='flex'; errbox.style.display='none'; statsCache={};
    try {
      const data = await sendMsg({ type:'GET_TICKER', symbol:ticker.symbol, range });
      applyUIData(data);
    } catch(err) {
      spin.style.display='none'; errbox.style.display='flex';
      errmsg.textContent = err.message.includes('No data') ? `No data for "${ticker.symbol}"` : 'Failed to load — check connection';
    }
  }

  // ─── Stats tab ────────────────────────────────────────────────────────────────
  async function loadStats() {
    $('stats-content').innerHTML = '<div class="stats-loading">Loading stats…</div>';
    try {
      const s = await sendMsg({ type:'GET_STATS', symbol:ticker.symbol });
      statsCache[ticker.symbol] = s;
      renderStats(s);
    } catch(e) { $('stats-content').innerHTML = `<div class="stats-loading">Stats unavailable — ${e.message}</div>`; }
  }
  function renderStats(s) {
    const f = (v) => v != null ? fmtPrice(v) : '—';
    const curr = s.price ?? 0;
    const fw52 = (s.fiftyTwoWeekHigh && s.fiftyTwoWeekLow && s.fiftyTwoWeekHigh !== s.fiftyTwoWeekLow)
      ? ((curr - s.fiftyTwoWeekLow) / (s.fiftyTwoWeekHigh - s.fiftyTwoWeekLow) * 100)
      : 50;
    const rows = [
      ['52W High', f(s.fiftyTwoWeekHigh), null, null],
      ['52W Low',  f(s.fiftyTwoWeekLow),  null, null],
      ['Day High', f(s.dayHigh),  null, null],
      ['Day Low',  f(s.dayLow),   null, null],
      ['Volume',   s.volume  ? fmtBig(s.volume)  : '—', null, null],
      ['Avg Vol',  s.avgVolume ? fmtBig(s.avgVolume) : '—', null, null],
      ['Mkt Cap',  s.marketCap ? fmtBig(s.marketCap) : '—', null, null],
      ['P/E Ratio', s.peRatio  != null ? s.peRatio.toFixed(2) : '—', null, null],
      ['Fwd P/E',  s.forwardPE != null ? s.forwardPE.toFixed(2) : '—', null, null],
      ['EPS',      s.eps != null ? fmtPrice(s.eps) : '—', null, null],
      ['Beta',     s.beta != null ? s.beta.toFixed(2) : '—', null, null],
      ['Div Yield',s.dividendYield != null ? (s.dividendYield*100).toFixed(2)+'%' : '—', null, null],
    ];
    $('stats-content').innerHTML = `
      <div class="stats-grid">
        ${rows.map(([lbl, val]) => `<div class="stat-item"><div class="stat-label">${lbl}</div><div class="stat-value">${escHtml(String(val))}</div></div>`).join('')}
      </div>
      <div style="padding:8px 14px;border-top:1px solid var(--border2)">
        <div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">52-Week Range</div>
        <div style="font-size:10px;color:var(--text2);display:flex;justify-content:space-between;margin-bottom:4px">
          <span>${f(s.fiftyTwoWeekLow)}</span><span>${f(s.fiftyTwoWeekHigh)}</span>
        </div>
        <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.max(0,Math.min(100,fw52))}%"></div></div>
      </div>`;
  }

  // ─── News tab ─────────────────────────────────────────────────────────────────
  async function loadNews() {
    $('news-content').innerHTML = '<div class="news-loading">Loading news…</div>';
    try {
      const items = await sendMsg({ type:'GET_NEWS', symbol:ticker.symbol });
      newsCache[ticker.symbol] = items;
      renderNews(items);
    } catch(_) { $('news-content').innerHTML = '<div class="news-loading">News unavailable</div>'; }
  }
  function renderNews(items) {
    if (!items?.length) { $('news-content').innerHTML = '<div class="news-loading">No news found</div>'; return; }
    $('news-content').innerHTML = items.map(n => `
      <a class="news-item" href="${escHtml(n.url)}" target="_blank" rel="noopener">
        <div class="news-title">${escHtml(n.title)}</div>
        <div class="news-meta"><span>${escHtml(n.publisher)}</span><span>${timeAgo(n.time)}</span></div>
      </a>`).join('');
  }

  // ─── Portfolio tab ────────────────────────────────────────────────────────────
  // ─── Fast alert polling — direct fetch, zero service worker overhead ─────────
  let alertPollTimer = null;

  // Content scripts can fetch Yahoo Finance directly (it's in host_permissions)
  // This avoids MV3 service worker startup lag entirely
  async function fetchPriceDirect(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=regularMarketPrice`;
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.quoteResponse?.result?.[0]?.regularMarketPrice ?? null;
    } catch (_) { return null; }
  }

  async function pollAlertPrice() {
    const { alerts: al = [] } = await new Promise(res => chrome.storage.local.get('alerts', res));
    if (!al.length) { stopAlertPolling(); return; }
    const price = await fetchPriceDirect(ticker.symbol);
    if (price != null) checkAlerts(price);
  }

  function startAlertPolling() {
    if (alertPollTimer) return;
    alertPollTimer = setInterval(pollAlertPrice, 5_000);
  }

  function stopAlertPolling() {
    clearInterval(alertPollTimer);
    alertPollTimer = null;
  }

  function syncAlertPolling() {
    chrome.storage.local.get('alerts', ({ alerts: al = [] }) => {
      al.length ? startAlertPolling() : stopAlertPolling();
    });
  }
  async function loadAlertsTab() {
    const { alerts: al=[] } = await new Promise(res => chrome.storage.local.get('alerts', res));
    alerts = al;
    if (!al.length) { $('alerts-list').innerHTML='<div class="alerts-empty">No alerts set</div>'; return; }
    $('alerts-list').innerHTML = al.map((a,i) => `
      <div class="alert-item">
        <div class="alert-sym">${escHtml(a.symbol)}</div>
        <div class="alert-desc">${a.direction==='above'?'≥':'≤'} ${a.target}</div>
        <button class="alert-del" data-i="${i}">×</button>
      </div>`).join('');
    $('alerts-list').querySelectorAll('.alert-del').forEach(btn => btn.addEventListener('click', async () => {
      const { alerts: al2=[] } = await new Promise(res => chrome.storage.local.get('alerts', res));
      al2.splice(+btn.dataset.i, 1);
      await new Promise(res => chrome.storage.local.set({ alerts: al2 }, res));
      syncAlertPolling();
      loadAlertsTab();
    }));
  }
  $('af-save').addEventListener('click', async () => {
    const dir=$('af-dir').value, target=parseFloat($('af-target').value);
    if (!target) return;
    const { alerts: al=[] } = await new Promise(res => chrome.storage.local.get('alerts', res));
    al.push({ id:Date.now(), symbol:ticker.symbol, direction:dir, target });
    await new Promise(res => chrome.storage.local.set({ alerts: al }, res));
    $('af-target').value='';
    syncAlertPolling();  // kick off fast polling immediately
    loadAlertsTab();
  });

  // ─── Search ───────────────────────────────────────────────────────────────────
  let searchTimer = null;
  function openSearch()  { searchInput.value=''; searchResults.innerHTML='<div class="sr-hint">Type a name or symbol — e.g. AAPL, Reliance, BTC, Nifty</div>'; searchOverlay.classList.add('visible'); searchInput.focus(); }
  function closeSearch() { searchOverlay.classList.remove('visible'); clearTimeout(searchTimer); }
  $('search-btn').addEventListener('click', e => { e.stopPropagation(); openSearch(); });
  $('search-x').addEventListener('click',   e => { e.stopPropagation(); closeSearch(); });
  searchInput.addEventListener('keydown', e => { if (e.key==='Escape') closeSearch(); });
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchResults.innerHTML='<div class="sr-hint">Type a name or symbol…</div>'; return; }
    searchResults.innerHTML='<div class="sr-loading">Searching…</div>';
    searchTimer = setTimeout(async () => {
      try {
        const results = await sendMsg({ type:'SEARCH_YF', query:q });
        if (!results?.length) { searchResults.innerHTML='<div class="sr-empty">No results</div>'; return; }
        searchResults.innerHTML = results.map(r => `
          <div class="sr-item" data-sym="${escHtml(r.symbol)}" data-name="${escHtml(r.name)}" data-exch="${escHtml(r.exchange)}" data-type="${escHtml(r.type)}">
            <span class="sr-sym">${escHtml(r.symbol)}</span>
            <span class="sr-name">${escHtml(r.name)}</span>
            <span class="sr-tag ${tagClass(r.type)}">${escHtml(r.type||'—')}</span>
            <span class="sr-exchange">${escHtml(r.exchange)}</span>
          </div>`).join('');
      } catch(_) { searchResults.innerHTML='<div class="sr-empty">Search failed</div>'; }
    }, 280);
  });
  searchResults.addEventListener('click', e => {
    const item = e.target.closest('.sr-item');
    if (!item) return;
    ticker = { symbol:item.dataset.sym, name:item.dataset.name, exchange:item.dataset.exch };
    // Add to watchlist
    chrome.storage.local.get('watchlist', ({watchlist:wl=[]}) => {
      if (!wl.find(w=>w.symbol===ticker.symbol)) { wl.unshift(ticker); chrome.storage.local.set({ watchlist:wl }); watchIdx=0; watchlist=wl; }
    });
    chrome.storage.local.set({ n50ticker:ticker });
    currency='USD'; pts=[]; statsCache={}; newsCache={};
    closeSearch(); updateTickerLabels(); loadData(activeRange);
  });

  // ─── Watchlist navigation ─────────────────────────────────────────────────────
  function setWatchTicker(idx) {
    if (!watchlist.length) return;
    watchIdx = ((idx % watchlist.length) + watchlist.length) % watchlist.length;
    ticker = watchlist[watchIdx];
    chrome.storage.local.set({ n50ticker:ticker });
    currency='USD'; pts=[]; statsCache={}; newsCache={};
    updateTickerLabels(); loadData(activeRange);
    if (activeTab==='stats') { $('stats-content').innerHTML='<div class="stats-loading">Loading…</div>'; loadStats(); }
    if (activeTab==='news')  { $('news-content').innerHTML='<div class="news-loading">Loading…</div>';  loadNews(); }
  }
  $('prev-ticker').addEventListener('click', e => { e.stopPropagation(); setWatchTicker(watchIdx-1); });
  $('next-ticker').addEventListener('click', e => { e.stopPropagation(); setWatchTicker(watchIdx+1); });

  // ─── Theme toggle ─────────────────────────────────────────────────────────────
  $('theme-btn').addEventListener('click', e => { e.stopPropagation(); theme = theme==='dark'?'light':'dark'; applyTheme(); });

  // ─── Share / copy chart ───────────────────────────────────────────────────────
  function copyChart(btn) {
    const HEADER = 44;
    const oc  = document.createElement('canvas');
    oc.width  = PW * DPR;
    oc.height = (CH + HEADER) * DPR;
    const c2  = oc.getContext('2d');

    // Background
    c2.fillStyle = '#0d1117';
    c2.fillRect(0, 0, oc.width, oc.height);

    // Divider between header and chart
    c2.fillStyle = 'rgba(255,255,255,0.07)';
    c2.fillRect(0, HEADER * DPR, oc.width, DPR);

    // Draw existing chart (already DPR-scaled) below header
    c2.drawImage(cv, 0, HEADER * DPR);

    // Header text — scale for DPR
    c2.save();
    c2.scale(DPR, DPR);
    const mid = HEADER / 2;

    // Left: ticker symbol + exchange
    c2.textBaseline = 'middle';
    c2.textAlign    = 'left';
    c2.fillStyle    = '#e6edf3';
    c2.font         = 'bold 14px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    c2.fillText(ticker.symbol, 14, mid - 7);
    c2.fillStyle = '#484f58';
    c2.font      = '10px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    c2.fillText(ticker.exchange || 'Yahoo Finance', 14, mid + 8);

    // Right: price + range
    const lastPrice = pts.length ? fmtPrice(pts[pts.length - 1].price) : '—';
    c2.textAlign = 'right';
    c2.fillStyle = isGreen ? '#00d4aa' : '#ff4757';
    c2.font      = 'bold 13px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    c2.fillText(lastPrice, PW - 14, mid - 7);
    c2.fillStyle = '#484f58';
    c2.font      = '10px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    c2.fillText(activeRange + ' · ' + new Date().toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'numeric', month:'short', year:'numeric' }), PW - 14, mid + 8);

    c2.restore();

    oc.toBlob(blob => {
      if (!blob) return;
      try {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => {
          btn.textContent = '✓ Copied!'; btn.classList.add('ok');
          setTimeout(() => { btn.textContent = '📋 Copy chart'; btn.classList.remove('ok'); }, 2000);
        }).catch(() => {
          btn.textContent = 'Copy failed';
          setTimeout(() => { btn.textContent = '📋 Copy chart'; }, 1500);
        });
      } catch (_) {
        btn.textContent = 'Not supported';
        setTimeout(() => { btn.textContent = '📋 Copy chart'; }, 1500);
      }
    });
  }
  $('copy-btn').addEventListener('click', e => { e.stopPropagation(); copyChart($('copy-btn')); });

  // ─── Range buttons ────────────────────────────────────────────────────────────
  rbtns.forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); if (b.dataset.r===activeRange) return;
    activeRange=b.dataset.r; loadData(activeRange);
  }));
  $('retry').addEventListener('click', () => loadData(activeRange));

  // ─── Context menu ─────────────────────────────────────────────────────────────
  function closeCtxMenu() { ctxMenu.classList.remove('show'); }
  pill.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    ctxMenu.style.left=e.clientX+'px'; ctxMenu.style.top=e.clientY+'px'; ctxMenu.style.right='auto'; ctxMenu.style.bottom='auto';
    ctxMenu.classList.add('show');
    requestAnimationFrame(() => {
      const mr = ctxMenu.getBoundingClientRect();
      if (mr.right>window.innerWidth)  ctxMenu.style.left=(e.clientX-mr.width)+'px';
      if (mr.bottom>window.innerHeight) ctxMenu.style.top=(e.clientY-mr.height)+'px';
    });
  });
  ctxMenu.addEventListener('click', e => {
    const item=e.target.closest('.ctx-item'); if (!item) return;
    if (item.dataset.mode) setMode(item.dataset.mode);
    if (item.id==='ctx-hide') hide();
    closeCtxMenu();
  });
  document.addEventListener('click',       closeCtxMenu, true);
  document.addEventListener('contextmenu', e => { if (!pill.contains(e.target)) closeCtxMenu(); }, true);
  restoreBtn.addEventListener('click', restore);

  // ─── Panel placement ──────────────────────────────────────────────────────────
  function updatePanelPlacement() {
    const right=parseFloat(host.style.right)||0, bottom=parseFloat(host.style.bottom)||0, pillH=hostOrigin?.h??36;
    panel.classList.toggle('flip',        window.innerHeight-bottom-pillH < 460);
    panel.classList.toggle('anchor-left', window.innerWidth-right < PW);
  }

  function snapToCorner() {
    const cr=parseFloat(host.style.right)||20, cb=parseFloat(host.style.bottom)||20;
    if (Math.abs(cr-20)<4 && Math.abs(cb-20)<4) return;
    host.style.transition='right .55s cubic-bezier(.4,0,.2,1), bottom .55s cubic-bezier(.4,0,.2,1)';
    host.style.right='20px'; host.style.bottom='20px'; host.style.left='auto'; host.style.top='auto';
    setTimeout(() => { host.style.transition=''; }, 650);
    chrome.storage.local.set({ n50pos:{ right:20, bottom:20 } });
  }

  wrap.addEventListener('mouseenter', () => {
    clearTimeout(hideTimer); clearTimeout(cornerTimer);
    updatePanelPlacement(); panel.classList.add('show');
    // Auto-refresh chart if data is stale (older than 30s)
    if (Date.now() - lastLoadTime > 30_000) loadData(activeRange);
  });
  wrap.addEventListener('mouseleave', () => {
    if (isDragging) return;
    hideTimer = setTimeout(() => {
      if (searchOverlay.classList.contains('visible')) return;
      panel.classList.remove('show'); hoverIdx=null; renderChart();
      if (snapEnabled) cornerTimer = setTimeout(snapToCorner, 3000);
    }, 160);
  });

  // ─── Drag ─────────────────────────────────────────────────────────────────────
  pill.addEventListener('mousedown', e => {
    if (e.button!==0) return; clearTimeout(cornerTimer);
    isDragging=true;
    const rect=host.getBoundingClientRect();
    dragStart={mx:e.clientX,my:e.clientY};
    hostOrigin={r:window.innerWidth-rect.right, b:window.innerHeight-rect.bottom, w:rect.width, h:rect.height};
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const nr=Math.max(0,Math.min(window.innerWidth-hostOrigin.w, hostOrigin.r-(e.clientX-dragStart.mx)));
    const nb=Math.max(0,Math.min(window.innerHeight-hostOrigin.h, hostOrigin.b-(e.clientY-dragStart.my)));
    host.style.right=nr+'px'; host.style.bottom=nb+'px'; host.style.left='auto'; host.style.top='auto';
    updatePanelPlacement();
  });
  document.addEventListener('mouseup', () => {
    if (!isDragging) return; isDragging=false;
    const rect=host.getBoundingClientRect();
    chrome.storage.local.set({ n50pos:{ right:Math.round(window.innerWidth-rect.right), bottom:Math.round(window.innerHeight-rect.bottom) } });
  });

  // ─── Keyboard shortcut from background ───────────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type==='TOGGLE_WIDGET')    { isHidden ? restore() : hide(); }
    if (msg.type==='SHOW_ALERT_TOAST') { showAlertToast(msg.alert, msg.price); }
  });

  // ─── Per-site ticker detection ────────────────────────────────────────────────
  const SITE_MAP = {
    'nseindia.com':'^NSEI', 'bseindia.com':'^BSESN', 'moneycontrol.com':'^NSEI',
    'economictimes.com':'^NSEI', 'nasdaq.com':'^IXIC', 'nyse.com':'^DJI',
    'coinbase.com':'BTC-USD', 'binance.com':'BTC-USD', 'crypto.com':'BTC-USD',
    'investing.com':'^NSEI', 'tradingview.com':'^NSEI',
  };
  function detectSiteTicker() {
    const host2 = window.location.hostname.replace(/^www\./, '');
    for (const [domain, sym] of Object.entries(SITE_MAP))
      if (host2.includes(domain)) return sym;
    return null;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['n50pos','n50ticker','n50mode','n50hidden','n50theme','watchlist','n50snap','n50autodetect'], r => {
    if (r.n50pos)    { host.style.right=r.n50pos.right+'px'; host.style.bottom=r.n50pos.bottom+'px'; }
    if (r.n50ticker) ticker = r.n50ticker;
    if (r.n50mode)   mode   = r.n50mode;
    if (r.n50theme)  theme  = r.n50theme;
    if (r.watchlist?.length) { watchlist=r.watchlist; watchIdx=watchlist.findIndex(w=>w.symbol===ticker.symbol); if(watchIdx<0) watchIdx=0; }
    else { watchlist=[ticker]; watchIdx=0; }
    isHidden  = !!r.n50hidden;
    snapEnabled = r.n50snap !== false;

    // Auto-detect site ticker
    if (r.n50autodetect !== false && !r.n50ticker) {
      const detected = detectSiteTicker();
      if (detected) { ticker = { symbol:detected, name:detected, exchange:'' }; }
    }

    applyMode(); applyTheme(); updateTickerLabels(); updatePanelPlacement();
    syncAlertPolling();  // start fast polling if alerts already exist
    loadData(activeRange);
  });

  setInterval(() => loadData(activeRange), 30_000);

})();
