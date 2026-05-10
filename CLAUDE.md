# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A fully client-side real estate investment decision tool (French language). No build step, no framework, no bundler — vanilla JS ES modules served as static files. All state lives in `localStorage`; there is no server.

Open `index.html` directly in a browser (or via a local static file server) to run the app. `python -m http.server 8080` works fine.

## Architecture

The app is split into four files:

| File | Role |
|---|---|
| `index.html` | Complete HTML structure with all panels and forms pre-declared |
| `main.js` | App shell: state management, DOM wiring, rendering, cross-window sync |
| `calculs.js` | Pure financial engine — all calculations, zero DOM access |
| `pdf.js` | Generates the printable decision PDF as a standalone HTML string |
| `styles.css` | Full design system (light/dark themes, all component classes) |
| `ui.js` | Supplementary UI helpers (inspect if touching charts or table markup) |

### Data flow

1. User edits the form in `index.html`
2. `main.js` reads form values → calls `sanitizeVariablesData()` → writes to `state.variablesData` and `localStorage`
3. On any change, `main.js` calls `computeAnalysisViewModel()` from `calculs.js`, which returns a fully computed view model
4. `main.js` renders that view model into the pre-declared DOM containers via `innerHTML` injection

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

### Decision model

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
