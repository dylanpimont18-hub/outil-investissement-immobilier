# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A desktop application for real estate investment analysis (French language). The app is packaged as a Windows `.exe` via PyInstaller. It uses a local Flask server + PyWebView window — no external server, no internet required for the UI.

To run in development: `python app.py` (starts Flask + opens a native window).
To build the distributable: run `build.bat`.

## Architecture

| File | Role |
|---|---|
| `app.py` | Desktop entry point: starts Flask thread, opens PyWebView window, manages system tray icon |
| `server.py` | Flask server: serves static files + scanner API (`/api/scan`, `/api/status`, `/api/results`) |
| `spark.spec` | PyInstaller build config |
| `build.bat` | Build script → `dist/Spark/Spark.exe` |
| `index.html` | Complete HTML structure with all panels and forms pre-declared |
| `main.js` | App shell: state management, DOM wiring, rendering, cross-window sync |
| `calculs.js` | Pure financial engine — all calculations, zero DOM access |
| `pdf.js` | Generates the printable decision PDF as a standalone HTML string |
| `scanner.js` | Scanner UI: triggers scraper, polls status, renders results table |
| `styles.css` | Full design system (light/dark themes, all component classes) |
| `ui.js` | Supplementary UI helpers (charts, table markup) |

### Data flow — analysis tool

1. User edits the form in `index.html`
2. `main.js` reads form values → calls `sanitizeVariablesData()` → writes to `state.variablesData` and `localStorage`
3. On any change, `main.js` calls `computeAnalysisViewModel()` from `calculs.js`, which returns a fully computed view model
4. `main.js` renders that view model into the pre-declared DOM containers via `innerHTML` injection

### Data flow — scanner

1. User clicks "Lancer le scan" in the scanner panel
2. `scanner.js` POSTs to `/api/scan` (or `/api/scan/full` to clear the DB first)
3. `server.py` runs `scraper/main.py` in a background thread with a `progress_callback`
4. `scanner.js` polls `/api/status` every 2 s to update the progress bar and logs
5. When scan finishes, `scanner.js` fetches `/api/results` — `server.py` reads from `scraper/biens.db` (SQLite) and returns JSON
6. Results are rendered in a sortable/filterable table

### Two-window mode

The app supports a split-screen mode where the analysis panel opens in a second popup window (`?panel=analysis`). State synchronizes between windows via `BroadcastChannel` (with `localStorage` as fallback). The `IS_ANALYSIS_WINDOW` flag in `main.js` controls which panels are shown.

### Key state shape (`state` object in `main.js`)

- `variablesData` — current study inputs (all form fields, sanitized)
- `assetRecords[]` — saved studies (comparator + portfolio)
- `activeAssetId` — which saved record is currently loaded
- `profileData` — household profile (income, adults, children) used for tax calculations
- `theme`, `screens` — UI preferences

### Financial engine (`calculs.js`)

- `computeAnalysisViewModel(inputs)` — main entry point for single-asset analysis; returns all metrics, decisions, scenarios, charts data
- `computePortfolioViewModel(assetRecords, profile, activeId, refInputs)` — consolidated portfolio view
- `computeCF(prixVendeur, loyer, inputs, tmi)` — core net-net cash-flow function used throughout
- `computeProjectMetrics(inputs)` — per-asset KPIs (rentaBrute, rentaNette, dscr, grm, coc…)
- `computeResaleTimeline(...)` — resale gain projection (used in `pdf.js`)
- Tax logic handles three regimes: `micro-foncier`, `reel` (foncier réel), `sci-is`

### Scraper (`scraper/`)

Multi-site real estate scraper targeting Centre-Val de Loire.

| File | Role |
|---|---|
| `scraper/main.py` | Orchestration: scrape → filter → AI enrichment → financial calc → SQLite |
| `scraper/db.py` | SQLite schema and connection (`biens.db` — `biens`, `annonces`, `historique_prix` tables) |
| `scraper/filtrage.py` | Deduplication: URL match, fingerprint cross-site match, new listing |
| `scraper/fingerprint.py` | Canonical fingerprint for cross-site dedup |
| `scraper/ia.py` | Anthropic batch enrichment (nb_pieces, travaux, DPE, résumé…) |
| `scraper/calculs.py` | Financial calculations specific to the scraper (CF, DSCR, score) |
| `scraper/utils.py` | DB insert helpers |
| `scraper/scrapers/` | One file per site (leboncoin, pap, seloger, logicimmo, bienici, orpi, century21, laforet, notaires, bellesdemeures) |
| `scraper/config.py` | **gitignored** — API keys and local parameters (copy from `config.example.py`) |
| `scraper/config.example.py` | Template for config.py |

### Decision model (analysis tool)

The acquisition decision is a composite score (0–100) built from: cash-flow, DSCR, net-net yield, price vs. offer ceiling, hypothesis confidence score, and stress-test results. Thresholds are user-configurable (`seuil-*` form fields). Decision tones: `excellent` → `positive` → `neutral` → `watch` → `negative`.

## Design system

The visual identity is documented in `charte_graphique.txt`. Key points:
- Fonts: Cormorant Garamond (display), IBM Plex Mono (data/numbers), Manrope (body)
- Accent color: `#C5A059` (light) / `#D4AF37` (dark) — gold
- Status tones map to CSS class suffixes: `--positive`, `--excellent`, `--watch`, `--negative`, `--neutral`
- Spacing is a 4px grid; corner radii: 8px (components), 12px (cards)
- Both themes are applied via `data-theme="light|dark"` on `<html>`

## Important conventions

- All user-facing text is in French.
- HTML is built via template literals in `main.js` — always run user content through `escapeHtml()` before injecting.
- New form fields require entries in: `VARIABLE_DEFAULTS`, `VARIABLE_KEYS` (derived), `sanitizeVariablesData()`, and the corresponding `<fieldset>` in `index.html`.
- `calculs.js` exports are pure functions — keep them free of DOM, `localStorage`, and `window` references.
- `computeAnalysisViewModel` is called on every keystroke; keep it synchronous and fast.
- `scraper/config.py` must never be committed — it contains API keys.
