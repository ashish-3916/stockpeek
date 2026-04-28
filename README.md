# StockPeek — Chrome Extension

A floating stock ticker for any Yahoo Finance symbol. Lives as a small circle in the corner of every page, expands on hover to show a live price chart.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![No API Key](https://img.shields.io/badge/API%20Key-Not%20Required-brightgreen)
[![Website](https://img.shields.io/badge/Website-ashish--3916.github.io/stockpeek-00d4aa)](https://ashish-3916.github.io/stockpeek/)

<a href='https://ko-fi.com/H2H71YLZOY' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

---

## Features

- **Circle by default** — unobtrusive 36px dot in the corner; green ▲ or red ▼ shows market direction at a glance
- **Hover to expand** — springs open to show ticker name, live price, and % change
- **Full chart panel** — interactive canvas chart with volume bars, previous close line, and OHLC tooltip
- **Time ranges** — 1D · 1W · 1M · 6M · 1Y · All
- **Any ticker** — search any Yahoo Finance symbol: stocks, indices, crypto, ETFs, mutual funds
- **Autocomplete search** — type a name or symbol, get live results with type badges
- **Stats tab** — 52W high/low, P/E, EPS, market cap, beta, dividend yield
- **News tab** — 6 latest headlines, click to open
- **Alerts tab** — set price alerts; price fetched **directly** from Yahoo Finance (no service worker hop) every 5 seconds — toast fires in under 5 seconds
- **Watchlist** — add multiple tickers, navigate with ‹ › arrows
- **Pre/After-hours** — shows pre-market and after-hours prices with badge
- **Copy chart** — copies chart image to clipboard with ticker header baked in
- **Light/dark theme** — toggle with ☀/🌙 button
- **Smart positioning** — panel flips above/below and left/right to stay on screen; circle drifts to bottom-right corner 3s after collapse
- **Draggable** — grab and reposition anywhere on screen; position persists across pages
- **Right-click menu** — switch between Full / Compact / Mini expanded views, or hide the widget
- **Auto-refresh** — chart refreshes every 30 seconds in background; also auto-refreshes instantly when you hover over the widget if data is older than 30 seconds
- **Per-site detection** — auto-switches to relevant ticker on NSE, Binance, Coinbase, etc.
- **No external dependencies** — pure canvas chart, no CDN, no API key required

---

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `stockpeek` folder
6. Visit any webpage — the circle appears in the bottom-right corner

> **If you see an auth error:** Visit [finance.yahoo.com](https://finance.yahoo.com) once in any tab. This sets the session cookies that the extension needs to fetch data. Then click **Retry**.

---

## Usage

### Hover to expand
Move your cursor over the circle to open the full widget with price, change, and chart.

### Change ticker
1. Hover to expand the widget
2. Click **⌕** next to the ticker name in the header
3. Type any stock name or symbol (e.g. `AAPL`, `Reliance`, `BTC`, `Nifty`)
4. Click a result — the chart loads instantly and the ticker is saved

**Supported formats:**
| Type | Examples |
|------|---------|
| Indian indices | `^NSEI` (Nifty 50), `^BSESN` (Sensex) |
| Indian stocks | `RELIANCE.NS`, `TCS.NS`, `INFY.NS` |
| US stocks | `AAPL`, `MSFT`, `GOOGL` |
| Crypto | `BTC-USD`, `ETH-USD` |
| ETFs | `GLD`, `SPY`, `QQQ` |
| Global indices | `^GSPC` (S&P 500), `^DJI` (Dow Jones) |

### Keyboard shortcuts
| Platform | Shortcut |
|----------|----------|
| Mac | `⌘ Command + Shift + M` |
| Windows / Linux | `Alt + M` |

> Remap anytime at `chrome://extensions/shortcuts`

### Right-click menu
Right-click the circle/pill to access:

| Option | Description |
|--------|-------------|
| **Full** | Shows ticker name + dot + price + % change when expanded |
| **Compact** | Shows ticker name + price (no % change) |
| **Mini** | Shows price only |
| **Hide widget** | Collapses to a restore circle; click it to show the widget again |

### Price Alerts
1. Hover to expand → click the **Alerts** tab
2. Choose direction (above / below) and enter a target price
3. Click **Set Alert** — toast fires **within 5 seconds** of the price crossing (direct fetch, no service worker delay)

### Drag to reposition
Click and drag the circle to move it anywhere on screen. Position is saved and restored across pages.

### Auto corner-snap
After hovering away, if you don't interact for 3 seconds, the circle smoothly slides to the bottom-right corner.

---

## Project Structure

```
stockpeek/
├── manifest.json     # Chrome Extension Manifest V3 config
├── background.js     # Service worker: data fetching, caching, alerts, shortcuts
├── content.js        # Injected widget: Shadow DOM, canvas chart, all UI logic
├── popup.html        # Toolbar popup: watchlist, alerts, settings
├── popup.js          # Popup logic
└── icons/            # Extension icons (16, 48, 128px)
```

### Architecture

```
┌─────────────────────────────────────────────┐
│  content.js (injected into every page)      │
│                                             │
│  Shadow DOM host (z-index: max)             │
│  ├── .pill (circle → expands on hover)      │
│  │   ├── .pill-face  (▲/▼ icon)             │
│  │   └── .pill-body  (ticker + price)       │
│  ├── .panel (chart + tabs)                  │
│  │   ├── Header (price, change, badge)      │
│  │   ├── Tabs: Chart | Stats | News | Alerts│
│  │   └── Search overlay                     │
│  ├── .ctx-menu (right-click)                │
│  └── .restore-btn (when hidden)             │
└───────────────┬─────────────────────────────┘
                │ chrome.runtime.sendMessage
                ▼
┌───────────────────────────────────────────────────┐
│  background.js (service worker)                   │
│  ├── GET_TICKER  → Yahoo Finance v8 chart API     │
│  ├── GET_STATS   → Yahoo Finance v7 quote API (reliable, same endpoint as prices) │
│  ├── GET_NEWS    → Yahoo Finance search API       │
│  ├── SEARCH_YF   → Yahoo Finance autocomplete     │
│  ├── GET_QUOTES  → Batch price fetch              │
│  ├── checkAlerts → chrome.alarms (1 min fallback for non-active tickers) │
│  └── 30s in-memory cache per symbol+range         │
└───────────────────────────────────────────────────┘
```

### Data Source

Yahoo Finance unofficial API — no API key required.

| Endpoint | Used for |
|----------|----------|
| `query1.finance.yahoo.com/v8/finance/chart/` | Price history + OHLC + volume |
| `query1.finance.yahoo.com/v7/finance/quote`  | Live price, stats, batch quotes |
| `query1.finance.yahoo.com/v1/finance/search` | Ticker autocomplete + news |
| `query1.finance.yahoo.com/v1/test/getcrumb`  | Session auth crumb |

---

## Permissions

| Permission | Reason |
|------------|--------|
| `storage` | Save ticker, watchlist, alerts, position, theme |
| `alarms` | Background price alert checking (1 min fallback) |
| `clipboardWrite` | Copy chart image to clipboard |
| `query1.finance.yahoo.com/*` | Fetch price data and search results |
| `query2.finance.yahoo.com/*` | Fallback for Yahoo Finance requests |

---

## Default Ticker

Defaults to **NIFTY 50** (`^NSEI`). Your last selected ticker is saved and restored automatically. On known financial sites (NSE India, Binance, Coinbase, etc.) it auto-detects the relevant ticker.

---

## Troubleshooting

**"Auth error — visit finance.yahoo.com once"**
Yahoo Finance requires session cookies. Open [finance.yahoo.com](https://finance.yahoo.com) in a tab, wait for it to load, then click Retry in the widget.

**"No data for this symbol"**
The symbol may be delisted or the format is wrong. Use the search to find the correct symbol.

**Widget not appearing**
- Check that the extension is enabled in `chrome://extensions`
- Try refreshing the page
- Some pages with strict CSP headers may block content scripts

**Chart shows old data**
Chart auto-refreshes every 30 seconds, and also refreshes instantly whenever you hover over the widget if data is older than 30 seconds. You can also force a refresh by switching time ranges.

**Alert toast not showing**
Make sure you're on a webpage (the widget only runs on pages, not on `chrome://` URLs). The toast appears on whatever tab is active when the alert triggers.
