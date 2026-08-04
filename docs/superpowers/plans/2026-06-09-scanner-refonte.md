# Scanner Refonte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Scanner panel to focus on Vierzon with configurable radius, improve the scraping pipeline efficiency, and unify the design with the Analyse/Portfolio panels.

**Architecture:** Backend changes (scraper pipeline, server API) are independent of frontend changes and can be parallelised. Within frontend, design unification (Group M) and ergonomics (Group L) can also be parallelised, then zone/radius wiring depends on both.

**Tech Stack:** Flask (server.py), Python (scraper/), Vanilla JS (scanner.js), HTML template literals, CSS custom properties (styles.css).

---

## File Map

| File | Tasks |
|---|---|
| `scraper/config.py` | B-config |
| `scraper/scrapers/leboncoin.py` | B-scraper |
| `scraper/scrapers/base.py` | B-base |
| `scraper/main.py` | G |
| `scraper/enrich.py` | J |
| `server.py` | B-api, H-backend |
| `index.html` | M1, L2, L4, B-ui (rayon HTML) |
| `scanner.js` | A, B-ui, C, D, E, H-frontend, I, K, L1, L2, L3, L4, L5, M2, M3 |
| `styles.css` | L6, M1-gradient, M4, M5, M6, DPE badge standalone |

---

## Phase 1 — Backend (Tasks 1 & 2 are independent, run in parallel)

---

### Task 1 — Pipeline efficiency: parallel descriptions (G) + pre-IA filter (J)

**Files:**
- Modify: `scraper/main.py` (function `_hydrate_descriptions`)
- Modify: `scraper/enrich.py` (function `enrich_pending`)

#### G — Parallel description hydration in `scraper/main.py`

- [ ] **Step 1: Replace sequential loop with ThreadPoolExecutor**

  In `scraper/main.py`, replace the body of `_hydrate_descriptions` (lines 65–80) with:

  ```python
  def _hydrate_descriptions(scraper, annonces: list[dict], emit, pct_scrape: int):
      if not annonces or not hasattr(scraper, "fetch_description"):
          return

      to_fetch = [a for a in annonces if not a.get("description") and a.get("url")]
      if not to_fetch:
          return

      emit(min(pct_scrape + 1, 95), f"  >> Extraction du contenu brut ({len(to_fetch)} annonces, 3 workers)…")

      import threading
      _rate_lock = threading.Semaphore(3)

      def _fetch_one(annonce):
          with _rate_lock:
              try:
                  annonce["description"] = scraper.fetch_description(annonce["url"]) or ""
              except Exception as e:
                  emit(pct_scrape, f"  [{scraper.site}] Description indisponible '{annonce['url'][:60]}' : {e}")
                  annonce["description"] = ""
              import time as _t; _t.sleep(1)

      from concurrent.futures import ThreadPoolExecutor, as_completed
      with ThreadPoolExecutor(max_workers=3) as pool:
          futures = {pool.submit(_fetch_one, a): a for a in to_fetch}
          for future in as_completed(futures):
              future.result()  # propagate exceptions if any
  ```

  Note: `time.sleep(1)` inside the semaphore lock means each worker sleeps 1s after its request, giving ~3 req/3s = 1 req/s globally, polite but 3× faster than the old 4s sequential loop.

- [ ] **Step 2: Verify imports** — `concurrent.futures` and `threading` are stdlib, no new dependencies.

#### J — Pre-IA filter in `scraper/enrich.py`

- [ ] **Step 3: Add pre-filter before batch Anthropic call**

  In `scraper/enrich.py`, after `annonces` list is built (after line ~110), add before the `_emit(10, ...)` call:

  ```python
      # ── 1.5 Préfiltrage pré-IA ─────────────────────────────────────────────
      avant_filtre = len(annonces)
      annonces = [
          a for a in annonces
          if a.get("description") or a.get("surface") or a.get("type_bien")
      ]
      filtres = avant_filtre - len(annonces)
      if filtres:
          _emit(9, f"  {filtres} biens sans données exploitables exclus du batch IA (description, surface et type_bien tous absents).")
  ```

  These excluded biens remain in the `biens` table without an `annonces` row, so they will be re-attempted next time `enrich_pending` runs (the query filters on `a.id IS NULL`).

- [ ] **Step 4: Commit Task 1**

  ```bash
  git add scraper/main.py scraper/enrich.py
  git commit -m "perf(scraper): descriptions parallèles (3 workers) + préfiltrage pré-IA"
  ```

---

### Task 2 — Rayon configurable — backend wiring (B-backend)

**Files:**
- Modify: `scraper/config.py` (⚠ gitignored — never commit)
- Modify: `scraper/scrapers/leboncoin.py`
- Modify: `scraper/scrapers/base.py`
- Modify: `server.py`

#### B-config — Reduce VILLES to Vierzon only

- [ ] **Step 1: Edit `scraper/config.py`**

  Find the `VILLES` list and replace its content with:
  ```python
  VILLES = [
      {"ville": "Vierzon", "code_postal": "18100", "dept": "18"},
  ]
  ```
  ⚠ This file is gitignored. Do not commit it.

#### B-scraper — Rayon URL in `leboncoin.py`

- [ ] **Step 2: Update `fetch_ville` in `scraper/scrapers/leboncoin.py`**

  Replace the `fetch_ville` method body (lines 57–74). The change: use `locations={cp}__{rayon_m}` when `rayon_km` is set:

  ```python
  def fetch_ville(self, ville: dict) -> list[dict]:
      annonces = []
      cp = ville["code_postal"]
      rayon_km = ville.get("rayon_km")
      loc_param = f"{cp}__{int(rayon_km * 1000)}" if rayon_km else cp

      ads, max_pages = self._fetch_page(loc_param, 1)
      if ads is None:
          return annonces

      annonces.extend(filter(None, (self._parse(ad, ville) for ad in ads)))

      for page in range(2, min(max_pages, 10) + 1):
          time.sleep(4)
          ads, _ = self._fetch_page(loc_param, page)
          if not ads:
              break
          annonces.extend(filter(None, (self._parse(ad, ville) for ad in ads)))

      return annonces
  ```

  Also update `_fetch_page` signature to accept `loc_param` instead of `code_postal`:

  ```python
  def _fetch_page(self, loc_param, page):
      session = crequests.Session(impersonate="chrome124")
      url = f"https://www.leboncoin.fr/recherche?category=9&locations={loc_param}&page={page}"
      # ... rest unchanged
  ```

#### B-base — Disable strict CP filter when rayon is set

- [ ] **Step 3: Edit `fetch_all` in `scraper/scrapers/base.py`**

  Replace lines 36–45 in `fetch_all`:

  ```python
          cp_cible = ville["code_postal"]
          has_rayon = bool(ville.get("rayon_km"))
          for a in annonces:
              url = a.get("url", "")
              if not url or url in seen_urls:
                  continue
              # Avec un rayon, l'API retourne des CP variés — ne pas filtrer strictement
              if not has_rayon:
                  cp_annonce = a.get("code_postal") or ""
                  if cp_annonce and cp_annonce != cp_cible:
                      continue
              seen_urls.add(url)
              a.setdefault("site", self.site)
              resultats.append(a)
  ```

#### B-api — Pass rayon_km through server.py

- [ ] **Step 4: Update `api_scan`, `api_scan_full`, and `_run_scanner` in `server.py`**

  **`api_scan` (line ~404):** Extract `rayon_km` and pass it:
  ```python
  @app.route("/api/scan", methods=["POST"])
  def api_scan():
      data = request.get_json(force=True, silent=True) or {}
      ville = (data.get("ville") or "").strip()
      code_postal = (data.get("code_postal") or "").strip()
      rayon_km = data.get("rayon_km")
      if isinstance(rayon_km, (int, float)) and rayon_km > 0:
          rayon_km = float(rayon_km)
      else:
          rayon_km = None
      if not ville or not code_postal:
          return jsonify({"error": "ville_required"}), 400

      with _lock:
          if scan_state["running"]:
              return jsonify({"error": "scan_running"}), 409
          scan_state["logs"] = []

      t = threading.Thread(target=_run_scanner, args=(False, ville, code_postal, rayon_km), daemon=True)
      t.start()
      return jsonify({"started": True})
  ```

  **`api_scan_full` (line ~422):** Same extraction, pass to `_run_scanner`:
  ```python
  @app.route("/api/scan/full", methods=["POST"])
  def api_scan_full():
      data = request.get_json(force=True, silent=True) or {}
      ville = (data.get("ville") or "").strip()
      code_postal = (data.get("code_postal") or "").strip()
      rayon_km = data.get("rayon_km")
      if isinstance(rayon_km, (int, float)) and rayon_km > 0:
          rayon_km = float(rayon_km)
      else:
          rayon_km = None
      if not ville or not code_postal:
          return jsonify({"error": "ville_required"}), 400

      with _lock:
          if scan_state["running"]:
              return jsonify({"error": "scan_running"}), 409
          scan_state["logs"] = []

      t = threading.Thread(target=_run_scanner, args=(True, ville, code_postal, rayon_km), daemon=True)
      t.start()
      return jsonify({"started": True, "db_cleared": True})
  ```

  **`_run_scanner` signature (line ~184):** Add `rayon_km=None` parameter and inject it into `villes_override`:
  ```python
  def _run_scanner(full: bool, ville: str = None, code_postal: str = None, rayon_km: float = None):
      # ... existing setup ...
      villes_override = [{"ville": ville, "code_postal": code_postal, "dept": (code_postal or "")[:2]}]
      if rayon_km:
          villes_override[0]["rayon_km"] = rayon_km
      # ... rest unchanged
  ```

- [ ] **Step 5: Commit Task 2**

  ```bash
  git add scraper/scrapers/leboncoin.py scraper/scrapers/base.py server.py
  git commit -m "feat(scanner): rayon configurable — URL LBC, filtre CP désactivé avec rayon, API rayon_km"
  ```

---

## Phase 2 — Badge baisse de prix (H) — depends on Task 2

### Task 3 — Price drop badge

**Files:**
- Modify: `server.py` (function `_query_results_data`)
- Modify: `scanner.js` (functions `_buildScannerSummaryRow`, `_renderGlobalOverviewTable`)

#### H-backend — Jointure historique_prix in `_query_results_data`

- [ ] **Step 1: Add baisse columns to the main SELECT in `_query_results_data`**

  In `server.py`, the `query` variable (line ~262). Add to the SELECT:
  ```sql
  (SELECT MAX(hp.prix_ancien) - b.prix
     FROM historique_prix hp WHERE hp.bien_id = b.id
     AND hp.prix_ancien > b.prix) AS baisse,
  (SELECT MAX(hp.date_changement)
     FROM historique_prix hp WHERE hp.bien_id = b.id
     AND hp.prix_ancien > b.prix) AS date_baisse,
  ```
  Full updated query SELECT block (replace lines 262–280):
  ```python
          query = """
              SELECT
                  b.id AS bien_id,
                  b.prix, b.surface, b.type_bien, b.ville, b.code_postal,
                  b.dpe, b.titre, b.url, b.site, b.date_derniere_vue,
                  a.cf_net, a.cf_apres_impot,
                  a.regime_optimal, a.loyer_source,
                  a.renta_brute, a.renta_nette_nette,
                  a.dscr, a.score, a.loyer_estime, a.mensualite,
                  a.resume_ia, a.points_faibles,
                  a.nb_pieces, a.travaux, a.travaux_montant,
                  a.immeuble_rapport, a.deja_loue, a.loyer_actuel,
                  a.meuble, a.parking_garage, a.chauffage,
                  a.date_enrichissement,
                  CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS ia_enrichi,
                  (SELECT MAX(hp.prix_ancien) - b.prix
                     FROM historique_prix hp WHERE hp.bien_id = b.id
                     AND hp.prix_ancien > b.prix) AS baisse,
                  (SELECT MAX(hp.date_changement)
                     FROM historique_prix hp WHERE hp.bien_id = b.id
                     AND hp.prix_ancien > b.prix) AS date_baisse
              FROM biens b
              LEFT JOIN annonces a ON a.bien_id = b.id
          """
  ```

#### H-frontend — Badge ↓ in scanner.js

- [ ] **Step 2: Add `baisse` and `date_baisse` to `_buildScannerSummaryRow`**

  In `_buildScannerSummaryRow` (around line 598), add after the `priceLabel` line:
  ```js
      const baisseValue = typeof r.baisse === 'number' && r.baisse > 0 ? r.baisse : null;
      const baisseDateLabel = baisseValue && r.date_baisse ? r.date_baisse.slice(0, 10) : null;
      const baisseLabel = baisseValue
        ? `↓ -${_fmtEur(baisseValue)}`
        : null;
  ```

  Add to the returned object:
  ```js
      baisseLabel,
      baisseDateLabel,
      baisseValue,
  ```

- [ ] **Step 3: Render badge in `_renderGlobalOverviewTable`**

  In the table row template (where `row.priceLabel` is rendered, line ~1176), replace:
  ```js
  <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">${row.priceLabel}</td>
  ```
  With:
  ```js
  <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">
    ${row.priceLabel}
    ${row.baisseLabel ? `<span class="scanner-price-drop" title="Ancien prix : +${_esc(row.baisseLabel.replace('↓ ', ''))} — baisse le ${_esc(row.baisseDateLabel || '?')}">${_esc(row.baisseLabel)}</span>` : ''}
  </td>
  ```

- [ ] **Step 4: Add CSS class `.scanner-price-drop` in `styles.css`**

  Find the `.scanner-stat-val.neg` block (around line 3734) and add after it:
  ```css
  .scanner-price-drop {
    display: inline-block;
    margin-left: 6px;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--success);
    background: rgba(var(--success-rgb), 0.12);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--font-mono);
  }
  ```

- [ ] **Step 5: Commit Task 3**

  ```bash
  git add server.py scanner.js styles.css
  git commit -m "feat(scanner): badge baisse de prix — jointure historique_prix + badge ↓ frontend"
  ```

---

## Phase 3 — Frontend pure (Tasks 4 & 5 are independent, run in parallel)

---

### Task 4 — Design unification (M1, M4, M5, M6)

**Files:**
- Modify: `index.html` (scanner panel header section)
- Modify: `styles.css` (gradient hardcode fix, M4 typography, M5 progress wrap, M6 empty state)

#### M1 — Replace scanner-header with workspace-hero-card structure

- [ ] **Step 1: Replace the `<div class="scanner-header">…</div>` block in `index.html`**

  The current block (lines 705–764) starts with `<div class="scanner-header">` and ends before `<section id="scanner-hero-summary"`.

  Replace it with:
  ```html
  <div class="workspace-hero scanner-workspace-hero">
    <div class="workspace-hero-card">
      <div class="workspace-hero-copy">
        <div class="workspace-hero-eyebrow">Scanner d'annonces</div>
        <h2>Base d'annonces locatives</h2>
        <p id="scanner-header-sub" class="workspace-hero-summary">Vierzon 18100</p>
        <div class="workspace-hero-meta">
          <span id="scanner-zone-chip" class="workspace-hero-chip">Vierzon 18100</span>
          <span id="scanner-results-meta" class="workspace-hero-chip" style="opacity:.7">Définissez une zone pour lancer un scan ciblé.</span>
        </div>
      </div>
      <div class="workspace-hero-score scanner-command-panel">
        <!-- Card Scan -->
        <section class="scanner-command-card scanner-command-card--primary">
          <div class="scanner-command-card__eyebrow">Prochain scan</div>
          <h3 class="scanner-command-card__title">Cibler une zone</h3>
          <div class="scanner-target-cp-group">
            <span class="scanner-target-cp-label">Zone</span>
            <div class="scanner-target-cp-input-wrap">
              <input id="scan-target-cp-input" type="text" placeholder="Code postal ou ville…"
                autocomplete="off" class="scanner-target-cp-input">
              <div id="scan-target-cp-dropdown" class="scanner-dropdown"></div>
            </div>
            <span id="scan-target-cp-badge" class="scanner-target-cp-badge"></span>
            <button id="scan-target-cp-reset" class="scanner-target-cp-reset">Réinitialiser</button>
          </div>
          <!-- Rayon selector (added in Task 6 / B-ui) -->
          <div id="scanner-rayon-group" class="scanner-rayon-group">
            <span class="scanner-rayon-label">Rayon</span>
            <div class="scanner-rayon-options">
              <label class="scanner-rayon-option"><input type="radio" name="scanner-rayon" value="5" checked> 5 km</label>
              <label class="scanner-rayon-option"><input type="radio" name="scanner-rayon" value="10"> 10 km</label>
              <label class="scanner-rayon-option"><input type="radio" name="scanner-rayon" value="20"> 20 km</label>
              <label class="scanner-rayon-option"><input type="radio" name="scanner-rayon" value="30"> 30 km</label>
            </div>
          </div>
          <div class="scanner-command-card__actions">
            <button id="btn-scan" class="btn btn--primary scanner-scan-btn" disabled>Lancer un scan</button>
            <div class="scanner-options-dropdown-wrap" style="position:relative;display:inline-block">
              <button id="btn-scan-options" class="btn btn--outline scanner-options-btn" type="button" aria-label="Options de scan">•••</button>
              <div id="scanner-options-dropdown" class="scanner-options-dropdown" hidden>
                <button id="btn-scan-full" type="button" class="scanner-options-item">Scan complet (vide cache)</button>
                <button id="btn-clear-cache" type="button" class="scanner-options-item">Vider le cache</button>
              </div>
            </div>
          </div>
        </section>
        <!-- Card Statut -->
        <section class="scanner-command-card scanner-command-card--secondary">
          <div class="scanner-command-card__top">
            <div id="scanner-status-chip" class="scanner-status-chip scanner-status--idle">
              <span id="scanner-status-dot" class="scanner-status-dot"></span>
              <span id="scanner-status-label">En attente</span>
            </div>
            <label for="scanner-missing-threshold" class="scanner-missing-threshold">
              <span>Biens absents</span>
              <select id="scanner-missing-threshold" title="Masquer un bien après plusieurs scans manqués" class="scanner-missing-threshold__select">
                <option value="0">Jamais</option>
                <option value="1">1 scan</option>
                <option value="2">2 scans</option>
                <option value="3">3 scans</option>
                <option value="5">5 scans</option>
                <option value="7">7 scans</option>
                <option value="10">10 scans</option>
              </select>
            </label>
          </div>
          <p class="scanner-command-card__copy">Le lot courant reste disponible entre deux scans. Lancez l'analyse IA pour structurer les fiches et homogénéiser la lecture des dossiers.</p>
          <div class="scanner-command-card__actions scanner-command-card__actions--secondary">
            <button id="btn-enrich" class="btn btn--outline scanner-btn--accent" disabled>Analyser avec l'IA <span id="enrich-pending-badge" class="scanner-inline-badge"></span></button>
          </div>
        </section>
      </div>
    </div>
  </div>
  ```

  Note: `btn-scan-full` and `btn-clear-cache` are now inside `#scanner-options-dropdown`. The old `scanner-btn--primary` and `scanner-btn--outline` become `btn btn--primary` / `btn btn--outline` (Task 5 / M2 aligns styles). `scanner-btn--accent` stays for the IA button.

#### M1 — Fix hardcoded rgba(59,130,246) gradient in `styles.css`

- [ ] **Step 2: Replace hardcoded blue gradient in scanner workspace-hero-card**

  Find in `styles.css` (line ~544–553):
  ```css
  #scanner-panel .workspace-hero-card {
      background: linear-gradient(180deg, color-mix(in srgb, rgba(59, 130, 246, 0.05) 100%, var(--surface-card)) 0%, var(--surface) 100%);
  ```
  Replace `rgba(59, 130, 246, 0.05)` with `rgba(var(--primary-rgb, 197, 160, 89), 0.05)`.

  Also fix line ~552 dark theme:
  ```css
  html[data-theme='dark'] #scanner-panel .workspace-hero-card {
      background: linear-gradient(180deg, color-mix(in srgb, rgba(59, 130, 246, 0.07) 100%, var(--surface-card)) 0%, var(--surface) 100%);
  ```
  Replace `rgba(59, 130, 246, 0.07)` with `rgba(var(--primary-rgb, 197, 160, 89), 0.07)`.

  Note: `--primary-rgb` may not be defined yet. Add it to the `:root` block in `styles.css`:
  ```css
  --primary-rgb: 197, 160, 89;
  ```
  And in `html[data-theme='dark']`:
  ```css
  --primary-rgb: 212, 175, 55;
  ```

#### M4 — Typography alignment in `styles.css`

- [ ] **Step 3: Update `.scanner-command-card__title` and `.scanner-command-card__eyebrow`**

  Find `.scanner-command-card__title` in `styles.css` and update or add:
  ```css
  .scanner-command-card__title {
    font-size: clamp(1.4rem, 2vw, 1.8rem);
    letter-spacing: -0.02em;
    font-family: var(--font-display, 'Cormorant Garamond', Georgia, serif);
    font-weight: 700;
    margin: 0 0 6px;
    line-height: 1.1;
  }
  .scanner-command-card__eyebrow {
    font-family: var(--font-mono, 'IBM Plex Mono', monospace);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.10em;
    color: var(--primary, #C5A059);
    font-weight: 600;
    margin-bottom: 4px;
  }
  ```

#### M5 — Progress bar inside workspace-hero-card

- [ ] **Step 4: Wrap `#scanner-progress` in `index.html`**

  Find `<div id="scanner-progress" class="scanner-progress" ...>` (line ~768) and wrap it:
  ```html
  <div id="scanner-progress-wrap" class="workspace-hero scanner-progress-hero" style="display:none">
    <div class="workspace-hero-card scanner-progress-card">
      <div id="scanner-progress" class="scanner-progress">
        <!-- existing content unchanged -->
      </div>
    </div>
  </div>
  ```

  Remove the `style="display:none"` from the inner `#scanner-progress` (control visibility via the wrapper now).

  Add CSS in `styles.css`:
  ```css
  .scanner-progress-hero .workspace-hero-card {
    border-radius: 18px;
    padding: 20px;
  }
  ```

  Update `scanner.js` wherever `#scanner-progress` is shown/hidden to use `#scanner-progress-wrap` instead:
  - Search for `scanner-progress` in `scanner.js` and replace `document.getElementById('scanner-progress')` visibility toggles with `document.getElementById('scanner-progress-wrap')`.

#### M6 — Empty state alignment in `styles.css`

- [ ] **Step 5: Update `.scanner-empty` in `styles.css`**

  Find `.scanner-empty` (around line 4835) and ensure it has:
  ```css
  .scanner-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 60px 24px;
    gap: 16px;
    color: var(--muted);
  }
  .scanner-empty__icon {
    font-size: 2.5rem;
    opacity: 0.4;
  }
  .scanner-empty__title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg);
    margin: 0;
  }
  .scanner-empty__sub {
    font-size: 0.85rem;
    margin: 0;
    max-width: 380px;
  }
  .scanner-empty .btn {
    margin-top: 8px;
  }
  ```

- [ ] **Step 6: Commit Task 4**

  ```bash
  git add index.html styles.css
  git commit -m "feat(scanner): design unification M1+M4+M5+M6 — workspace-hero-card, typo tokens, progress wrap, empty state"
  ```

---

### Task 5 — Ergonomics: L1 (8-column table) + L2 (dynamic header) + L3 (DPE badge) + L5 (stats) + L6 (filter hover)

**Files:**
- Modify: `scanner.js` (functions `_renderGlobalOverviewTable`, `_buildScannerSummaryRow`, `_renderScannerStats` or equivalent, `_renderScannerHero`)
- Modify: `styles.css` (L6 filter hover, L3 DPE badge standalone styles, L5 stats)

#### L1 — 8-column table in `_renderGlobalOverviewTable`

The current table has 13 columns: Classement, Bien, Statut, Décision, Prix, Loyer, CF après impôt, Renta N/N, DSCR, Score, Régime, DPE, Signaux.

Target: 8 columns: Rang, Bien (with inline badges), Prix (with baisse), Loyer, CF fiscal, Renta N/N, DPE (colored), Score/Décision.

- [ ] **Step 1: Update the `<thead>` in `_renderGlobalOverviewTable`**

  Replace the current `<thead>` block inside `_renderGlobalOverviewTable` (line ~1230) with:
  ```js
  <thead>
    <tr>
      <th class="scanner-align-left" style="width:60px">Rang</th>
      <th class="scanner-align-left">Bien</th>
      <th class="scanner-align-right">Prix</th>
      <th class="scanner-align-right">Loyer</th>
      <th class="scanner-align-right">CF fiscal</th>
      <th class="scanner-align-right">Renta N/N</th>
      <th class="scanner-align-center" style="width:60px">DPE</th>
      <th class="scanner-align-left">Score / Décision</th>
    </tr>
  </thead>
  ```

- [ ] **Step 2: Update each `<tr>` in `rowsHtml` map**

  Replace the full row template (lines ~1161–1191) with:
  ```js
  const rowsHtml = rows.map(row => {
    const cfTone = row.cfAfterTaxValue != null && row.cfAfterTaxValue >= 0 ? 'positive' : 'negative';
    const dpeBadge = row.raw.dpe
      ? `<span class="scanner-dpe-badge scanner-dpe-badge--${row.raw.dpe.toLowerCase()}">${row.raw.dpe.toUpperCase()}</span>`
      : '<span class="scanner-dpe-badge scanner-dpe-badge--nc">—</span>';
    const statusInline = _renderScannerTonePill(row.statusLabel, row.statusTone);
    const signals = row.raw.ia_enrichi && row.signalsLabel !== 'RAS'
      ? `<span class="scanner-signal-inline">${_esc(row.signalsLabel)}</span>`
      : '';
    const freshness = row.raw.date_derniere_vue
      ? _renderFreshnessLabel(row.raw.date_derniere_vue)
      : '';
    const priceDrop = row.baisseLabel
      ? `<span class="scanner-price-drop" title="Baisse le ${_esc(row.baisseDateLabel || '?')}">${_esc(row.baisseLabel)}</span>`
      : '';
    return `
      <tr class="scanner-summary-row${row.raw.ia_enrichi ? '' : ' scanner-summary-row--pending'}" data-bien-id="${row.bienId}">
        <td class="scanner-align-left scanner-summary-cell scanner-summary-cell--rank">
          ${_renderRankPill(row.rankIndex, row.rankLabel, row.rankScore)}
        </td>
        <td class="scanner-align-left scanner-summary-cell scanner-summary-cell--primary">
          <div class="scanner-summary-row__title">${_esc(row.title)}</div>
          <div class="scanner-summary-row__subtitle">${_esc(row.subtitle || '')}</div>
          <div class="scanner-summary-row__badges">${statusInline}${signals}</div>
          ${freshness}
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">
          <div>${row.priceLabel}${priceDrop}</div>
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">
          <div>${row.rentLabel}</div>
          <div class="scanner-summary-row__aux">${_esc(row.rentSourceLabel)}</div>
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">
          <span class="scanner-summary-row__value scanner-summary-row__value--${cfTone}">${row.cfAfterTaxLabel}</span>
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">${row.rentaNetNetLabel}</td>
        <td class="scanner-align-center scanner-summary-cell">${dpeBadge}</td>
        <td class="scanner-align-left scanner-summary-cell">
          <div class="scanner-score-decision">
            <span class="scanner-score-decision__score">${row.scoreLabel}</span>
            ${_renderScannerTonePill(row.decisionLabel, row.decisionTone)}
          </div>
        </td>
      </tr>`;
  }).join('');
  ```

- [ ] **Step 3: Add helper `_renderFreshnessLabel` in scanner.js** (add near the other helpers, before `_renderGlobalOverviewTable`):

  ```js
  function _renderFreshnessLabel(dateDerniereVue) {
    if (!dateDerniereVue) return '';
    const daysDiff = Math.floor((Date.now() - new Date(dateDerniereVue).getTime()) / 86400000);
    const label = daysDiff === 0 ? 'Vu aujourd\'hui' : `Vu il y a ${daysDiff} j`;
    const staleClass = daysDiff > 10 ? ' scanner-freshness--stale' : '';
    return `<div class="scanner-freshness${staleClass}">${label}</div>`;
  }
  ```

#### L2 — Dynamic header subtitle

- [ ] **Step 4: Update `_renderScannerHero` in scanner.js to set `#scanner-header-sub` and `#scanner-zone-chip`**

  Find `_renderScannerHero` and after `_allResultats` are loaded, add/update this logic. In the function that renders stats (called after results load), after setting the stats, add:

  ```js
  function _updateScannerHeaderSub() {
    const sub = document.getElementById('scanner-header-sub');
    const chip = document.getElementById('scanner-zone-chip');
    const rayonKm = _getScannerRayonKm();
    const zone = _scanTarget ? `${_scanTarget.commune} ${_scanTarget.cp}` : 'Vierzon 18100';
    const count = _allResultats.length;
    const label = count
      ? `${zone} · ${rayonKm} km · ${count} bien${count > 1 ? 's' : ''}`
      : zone;
    if (sub) sub.textContent = label;
    if (chip) chip.textContent = zone;
  }
  ```

  Call `_updateScannerHeaderSub()` inside the function that processes results (near `_renderScannerStats`).

#### L3 — DPE colored badge styles in `styles.css`

- [ ] **Step 5: Add standalone DPE badge CSS** (these are for the table, not the filter chips):

  ```css
  .scanner-dpe-badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    border: 1px solid transparent;
  }
  .scanner-dpe-badge--a { background: rgba(0,165,80,.15); color: #00a550; border-color: #00a550; }
  .scanner-dpe-badge--b { background: rgba(81,184,69,.15); color: #3a9e2e; border-color: #3a9e2e; }
  .scanner-dpe-badge--c { background: rgba(200,210,0,.15); color: #7c8400; border-color: #9fa800; }
  .scanner-dpe-badge--d { background: rgba(255,204,0,.15); color: #8a7000; border-color: #b89200; }
  .scanner-dpe-badge--e { background: rgba(244,166,35,.15); color: #c07c00; border-color: #f4a623; }
  .scanner-dpe-badge--f { background: rgba(227,114,12,.15); color: #c05000; border-color: #e3720c; }
  .scanner-dpe-badge--g { background: rgba(204,0,0,.15); color: #cc0000; border-color: #cc0000; }
  .scanner-dpe-badge--nc { color: var(--muted); font-size: 0.85rem; }
  ```

  Also add:
  ```css
  .scanner-freshness {
    font-size: 0.72rem;
    color: var(--muted);
    margin-top: 2px;
  }
  .scanner-freshness--stale { color: var(--watch, #d97706); }
  .scanner-signal-inline {
    font-size: 0.72rem;
    color: var(--muted);
    margin-left: 4px;
  }
  .scanner-score-decision {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .scanner-score-decision__score {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--fg);
  }
  ```

#### L5 — Stats row: chiffre principal mis en avant

- [ ] **Step 6: Update stat rendering in scanner.js**

  Find `_renderScannerStats` (or wherever `.scanner-stat` HTML is built). The stat template currently produces `scanner-stat-val` and `scanner-stat-lbl`. Change the structure to:

  ```js
  function _buildStatCard(value, label, tone = '') {
    const toneClass = tone ? ` ${tone}` : '';
    return `
      <article class="scanner-stat">
        <span class="scanner-stat-val${toneClass}">${_esc(String(value))}</span>
        <span class="scanner-stat-lbl">${_esc(label)}</span>
      </article>`;
  }
  ```

  Update `.scanner-stat-val` in `styles.css`:
  ```css
  .scanner-stat-val {
    display: block;
    font-size: 1.5rem;
    font-weight: 700;
    font-family: var(--font-mono);
    line-height: 1;
    margin-bottom: 4px;
  }
  .scanner-stat-lbl {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
  }
  ```

#### L6 — Filter accordion hover

- [ ] **Step 7: Add hover rule for filter section title in `styles.css`**

  Find `.scanner-filter-section-title` and add/update:
  ```css
  .scanner-filter-section-title {
    cursor: pointer;
    padding: 6px 8px;
    margin: 0 -8px;
    border-radius: var(--radius-sm, 6px);
    transition: background 0.15s;
  }
  .scanner-filter-section-title:hover {
    background: var(--surface-hover, var(--surface-strong));
  }
  ```

- [ ] **Step 8: Commit Task 5**

  ```bash
  git add scanner.js styles.css
  git commit -m "feat(scanner): ergonomie L1+L2+L3+L5+L6 — tableau 8 colonnes, header dynamique, DPE coloré, stats, filtres hover"
  ```

---

## Phase 4 — Wiring & remaining frontend (depends on Tasks 4 & 5)

---

### Task 6 — Zone pré-remplie + sélecteur rayon frontend (A + B-ui)

**Files:**
- Modify: `scanner.js` (init, `_initScanTargetSelector`, scan submission)

#### A — Zone pré-remplie (Vierzon 18100 par défaut)

- [ ] **Step 1: Add default in `_initScanTargetSelector`**

  After calling `_initScanTargetSelector()` in `_bindButtons` / `initScanner`, add:
  ```js
  // Pré-remplir Vierzon si aucune zone mémorisée
  const savedTarget = _loadScanTargetFromStorage();
  if (savedTarget) {
    _setScanTarget(savedTarget.cp, savedTarget.commune, savedTarget.label);
  } else {
    _loadCommunesData().then(() => {
      _setScanTarget('18100', 'Vierzon', 'Vierzon — 18100');
    });
  }
  ```

  Add persistence helpers:
  ```js
  const SCANNER_TARGET_STORAGE_KEY = 'investissementWebScannerTarget';

  function _loadScanTargetFromStorage() {
    try {
      const raw = localStorage.getItem(SCANNER_TARGET_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function _saveScanTargetToStorage(target) {
    try {
      localStorage.setItem(SCANNER_TARGET_STORAGE_KEY, JSON.stringify(target));
    } catch {}
  }
  ```

  In `_setScanTarget`, call `_saveScanTargetToStorage(_scanTarget)` after setting `_scanTarget`.

#### B-ui — Rayon sélecteur wiring

- [ ] **Step 2: Add rayon state and persistence**

  ```js
  const SCANNER_RAYON_STORAGE_KEY = 'scannerRayonKm';
  let _scannerRayonKm = _loadRayonKm();

  function _loadRayonKm() {
    try {
      const raw = localStorage.getItem(SCANNER_RAYON_STORAGE_KEY);
      const parsed = Number(raw);
      return [5, 10, 20, 30].includes(parsed) ? parsed : 5;
    } catch { return 5; }
  }

  function _getScannerRayonKm() {
    return _scannerRayonKm;
  }

  function _setRayonKm(km) {
    _scannerRayonKm = km;
    try { localStorage.setItem(SCANNER_RAYON_STORAGE_KEY, String(km)); } catch {}
    _updateScannerHeaderSub();
  }
  ```

- [ ] **Step 3: Wire the radio buttons in `_bindButtons`**

  ```js
  document.querySelectorAll('input[name="scanner-rayon"]').forEach(radio => {
    // restore saved value
    if (Number(radio.value) === _scannerRayonKm) radio.checked = true;
    radio.addEventListener('change', () => {
      if (radio.checked) _setRayonKm(Number(radio.value));
    });
  });
  ```

- [ ] **Step 4: Include `rayon_km` in scan POST body**

  Find `_startScan` function in `scanner.js`. Update the fetch body:
  ```js
  body: JSON.stringify({
    ville: _scanTarget.commune,
    code_postal: _scanTarget.cp,
    rayon_km: _getScannerRayonKm(),
  }),
  ```

#### L4 — Options dropdown ⋯ wiring

- [ ] **Step 5: Wire the options dropdown in `_bindButtons`**

  ```js
  const optionsBtn = document.getElementById('btn-scan-options');
  const optionsDropdown = document.getElementById('scanner-options-dropdown');
  optionsBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const isHidden = optionsDropdown.hidden;
    optionsDropdown.hidden = !isHidden;
  });
  document.addEventListener('click', () => {
    if (optionsDropdown) optionsDropdown.hidden = true;
  });
  document.getElementById('btn-scan-full')?.addEventListener('click', () => {
    optionsDropdown.hidden = true;
    if (confirm('Vider le cache et relancer un scan complet sur toutes les annonces ?')) {
      _startScan('/api/scan/full');
    }
  });
  ```

  Add CSS for the dropdown in `styles.css`:
  ```css
  .scanner-options-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: var(--surface-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 0;
    min-width: 220px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    z-index: 200;
  }
  .scanner-options-item {
    display: block;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    text-align: left;
    font: inherit;
    font-size: 0.875rem;
    color: var(--fg);
    cursor: pointer;
  }
  .scanner-options-item:hover {
    background: var(--surface-hover, var(--surface-strong));
  }
  .scanner-rayon-group {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0;
    flex-wrap: wrap;
  }
  .scanner-rayon-label {
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 600;
    min-width: 36px;
  }
  .scanner-rayon-options {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .scanner-rayon-option {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .scanner-rayon-option:has(input:checked) {
    border-color: var(--primary);
    background: rgba(var(--primary-rgb), 0.1);
    color: var(--primary);
    font-weight: 600;
  }
  .scanner-rayon-option input { display: none; }
  ```

#### M2 + M3 — Button class alignment + mini-cards

- [ ] **Step 6: Add CSS aliases in `styles.css`** (so `btn btn--primary` renders identically to old `scanner-btn--primary`):

  Find the existing `.btn--primary` in `styles.css` (used in portfolio/analysis). If the existing class already has the right appearance, add:
  ```css
  /* Scanner button aliases → global btn classes */
  .scanner-scan-btn.btn--primary { /* inherits .btn--primary */ }
  ```

  If `.btn--primary` doesn't exist, add near `.scanner-btn--primary`:
  ```css
  .btn--primary {
    background: var(--primary, #C5A059);
    color: #fff;
    border: none;
    border-radius: 999px;
    padding: 10px 20px;
    font: inherit;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: opacity .15s, transform .15s;
  }
  .btn--primary:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); }
  .btn--primary:disabled { opacity: .45; cursor: not-allowed; }
  .btn--outline {
    background: transparent;
    border: 1px solid var(--border-strong, var(--border));
    border-radius: 999px;
    padding: 10px 20px;
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    color: var(--fg);
    transition: background .15s;
  }
  .btn--outline:hover:not(:disabled) { background: var(--surface-strong); }
  .btn--outline:disabled { opacity: .45; cursor: not-allowed; }
  ```

  For M3 stats (`.scanner-stat` → `.workspace-hero-mini-card`): the stats are rendered dynamically in scanner.js. Update `_renderScannerStats` to use `.workspace-hero-mini-card` structure:
  ```js
  function _buildStatMiniCard(value, label, tone = '') {
    const toneClass = tone ? ` scanner-stat--${tone}` : '';
    return `
      <article class="workspace-hero-mini-card${toneClass}">
        <strong>${_esc(String(value))}</strong>
        <span>${_esc(label)}</span>
      </article>`;
  }
  ```

- [ ] **Step 7: Commit Task 6**

  ```bash
  git add scanner.js styles.css
  git commit -m "feat(scanner): zone pré-remplie Vierzon, sélecteur rayon, dropdown ⋯, boutons globaux, mini-cards"
  ```

---

### Task 7 — Top 5 curation cards (I) + Indicateur fraîcheur (K)

**Files:**
- Modify: `scanner.js` (functions `_renderScannerRankingStrip`, `_renderGlobalOverviewTable`)

Note: `_renderFreshnessLabel` was already added in Task 5 Step 3. `_renderScannerRankingStrip` currently shows top 3. Spec I asks for top 5.

#### I — Expand to Top 5

- [ ] **Step 1: Update `_renderScannerRankingStrip`**

  Change `.slice(0, 3)` to `.slice(0, 5)` (line ~790):
  ```js
  const ranked = rows.filter(row => row.raw.ia_enrichi).slice(0, 5);
  ```

  Update the card to also show `résumé IA`:
  ```js
  const resumeSnippet = row.resumeLabel
    ? `<div class="scanner-curation-card__resume">${_esc(row.resumeLabel.slice(0, 120))}${row.resumeLabel.length > 120 ? '…' : ''}</div>`
    : '';
  ```

  Add it inside the article, after `scanner-curation-card__detail`:
  ```js
  ${resumeSnippet}
  ```

  Add CSS:
  ```css
  .scanner-curation-card__resume {
    font-size: 0.78rem;
    color: var(--muted);
    margin-top: 6px;
    line-height: 1.5;
  }
  ```

#### K — Freshness already wired in L1 table rows

The `_renderFreshnessLabel` helper was added in Task 5. The `--stale` class is already styled. Task K is complete as part of Task 5.

- [ ] **Step 2: Commit Task 7**

  ```bash
  git add scanner.js styles.css
  git commit -m "feat(scanner): top 5 curation cards avec résumé IA"
  ```

---

### Task 8 — Commune/distance badge + distance filter + map (C, D, E)

**Files:**
- Modify: `scanner.js` (distance calc, distance filter, map circle)
- Modify: `index.html` (slider in `#scanner-filters`)

#### C — Badge commune + distance

- [ ] **Step 1: Add distance calculator helper in `scanner.js`**

  ```js
  const VIERZON_LAT = 47.222;
  const VIERZON_LNG = 2.069;

  function _haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  ```

  Since coordinates per commune are not in the JSON file (only names and CPs), use a fallback static map for common communes around Vierzon. Add a small cache object:

  ```js
  // Coordonnées approximatives des communes 18/41/36/45 proches de Vierzon
  const _COMMUNE_COORDS = {
    '18100': [47.222, 2.069], // Vierzon
    '18200': [47.080, 2.397], // Saint-Amand-Montrond
    '18300': [47.142, 2.729], // Bourges (approx)
    '36100': [46.836, 1.691], // Issoudun
    '41200': [47.348, 1.733], // Romorantin
    '45300': [47.748, 2.366], // Pithiviers (far)
  };

  function _getDistanceKmFromVierzon(codePostal) {
    const coords = _COMMUNE_COORDS[codePostal];
    if (!coords) return null;
    return _haversineKm(VIERZON_LAT, VIERZON_LNG, coords[0], coords[1]);
  }
  ```

  Note: For future improvement, the DB has a `geocodes` table. For now, CP-based fallback is sufficient.

- [ ] **Step 2: Add distance to `_buildScannerSummaryRow`**

  ```js
  const distKm = _getDistanceKmFromVierzon(r.code_postal);
  const distLabel = distKm != null ? `${Math.round(distKm)} km` : null;
  const distTone = distKm == null ? '' : distKm < 10 ? 'near' : distKm < 20 ? 'mid' : 'far';
  ```

  Add to returned object: `distLabel, distTone`.

- [ ] **Step 3: Render commune badge in table cell "Bien"**

  In the row template (Task 5 Step 2), inside the `Bien` cell, add after subtitle:
  ```js
  ${row.distLabel ? `<span class="scanner-dist-badge scanner-dist-badge--${row.distTone}">${_esc(row.raw.ville || '')} · ${_esc(row.distLabel)}</span>` : ''}
  ```

  Add CSS:
  ```css
  .scanner-dist-badge {
    display: inline-block;
    font-size: 0.7rem;
    padding: 1px 6px;
    border-radius: 4px;
    margin-top: 2px;
  }
  .scanner-dist-badge--near { background: rgba(var(--success-rgb),0.1); color: var(--success); }
  .scanner-dist-badge--mid  { background: rgba(var(--watch-rgb),0.1); color: var(--watch); }
  .scanner-dist-badge--far  { background: rgba(var(--danger-rgb),0.1); color: var(--danger); }
  ```

#### D — Distance filter slider

- [ ] **Step 4: Add slider to `#scanner-filters` in `index.html`**

  Find the `<div id="scanner-filters"` section in index.html. Add a new filter section before the closing tag:
  ```html
  <div class="scanner-filter-section">
    <div class="scanner-filter-section-title">
      <span>Distance</span>
      <span id="scanner-dist-filter-value" class="scanner-filter-section-value">50 km</span>
    </div>
    <div class="scanner-filter-section-body">
      <input type="range" id="scanner-dist-filter" min="1" max="50" value="50" step="1"
        class="scanner-range-input" style="width:100%">
      <div class="scanner-range-labels"><span>1 km</span><span>50 km</span></div>
    </div>
  </div>
  ```

- [ ] **Step 5: Wire the slider in `scanner.js`**

  Add state variable:
  ```js
  let _distanceFilterKm = 50;
  ```

  In `_bindButtons`, add:
  ```js
  const distSlider = document.getElementById('scanner-dist-filter');
  const distLabel = document.getElementById('scanner-dist-filter-value');
  distSlider?.addEventListener('input', () => {
    _distanceFilterKm = Number(distSlider.value);
    if (distLabel) distLabel.textContent = `${_distanceFilterKm} km`;
    _applyTable();
  });
  ```

  In `_applyTable` / filter function, add distance check:
  ```js
  function _matchDistance(r) {
    if (_distanceFilterKm >= 50) return true; // slider à max = pas de filtre
    const dist = _getDistanceKmFromVierzon(r.code_postal);
    if (dist == null) return true; // CP inconnu → ne pas exclure
    return dist <= _distanceFilterKm;
  }
  ```

  Add `&& _matchDistance(r)` to the existing filter chain in `_applyTable`.

#### E — Carte centrée Vierzon + cercle rayon

- [ ] **Step 6: Update map initialization in `scanner.js`**

  Find where the Leaflet map is initialized (search for `L.map` or `tab-carte`). When the map is created, set the center to Vierzon and add a radius circle. If the map init code doesn't exist yet, add it in `_setScannerView` or when `tab-carte` is activated:

  ```js
  let _mapRadiusCircle = null;

  function _initScannerMap() {
    const mapEl = document.getElementById('scanner-map');
    if (!mapEl || mapEl._leaflet_id) return; // already initialized

    const map = L.map('scanner-map').setView([VIERZON_LAT, VIERZON_LNG], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    mapEl._mapInstance = map;
    _updateMapRadiusCircle(map);
  }

  function _updateMapRadiusCircle(map) {
    if (!map) return;
    if (_mapRadiusCircle) { _mapRadiusCircle.remove(); }
    const rayonM = _getScannerRayonKm() * 1000;
    _mapRadiusCircle = L.circle([VIERZON_LAT, VIERZON_LNG], {
      radius: rayonM,
      color: '#C5A059',
      fillColor: '#C5A059',
      fillOpacity: 0.06,
      weight: 2,
    }).addTo(map);
    map.setView([VIERZON_LAT, VIERZON_LNG], 10);
  }
  ```

  Call `_updateMapRadiusCircle(mapEl._mapInstance)` whenever rayon changes (inside `_setRayonKm`).

- [ ] **Step 7: Commit Task 8**

  ```bash
  git add scanner.js index.html styles.css
  git commit -m "feat(scanner): commune/distance badge, filtre distance slider, carte Vierzon + cercle rayon"
  ```

---

### Task 9 — CODEBASE_MAP update

- [ ] **Step 1: Update `CODEBASE_MAP.md`** entries for all modified files:

  - `server.py`: add `_run_scanner(full, ville, code_postal, rayon_km)` — rayon support
  - `scanner.js`: add `_renderFreshnessLabel(date)`, `_getScannerRayonKm()`, `_setRayonKm(km)`, `_getDistanceKmFromVierzon(cp)`, `_haversineKm(...)`, `_updateScannerHeaderSub()`, `_buildStatMiniCard(...)`, `_initScannerMap()`, `_updateMapRadiusCircle(...)`
  - `scraper/main.py`: note parallel description hydration
  - `scraper/enrich.py`: note pre-IA filter
  - `scraper/scrapers/leboncoin.py`: note rayon_km URL support
  - `scraper/scrapers/base.py`: note CP filter bypass when rayon set

- [ ] **Step 2: Commit Task 9**

  ```bash
  git add CODEBASE_MAP.md
  git commit -m "docs: mise à jour CODEBASE_MAP après refonte scanner"
  ```

---

## Self-Review Checklist

### Spec coverage

| Group | Item | Task |
|---|---|---|
| A | Zone pré-remplie Vierzon | Task 6 Step 1 |
| B | Rayon sélecteur + propagation | Tasks 2 + 6 |
| C | Badge commune + distance | Task 8 Steps 2-3 |
| D | Filtre distance slider | Task 8 Steps 4-5 |
| E | Carte centrée Vierzon + cercle | Task 8 Step 6 |
| G | Descriptions parallèles | Task 1 |
| H | Badge baisse de prix | Task 3 |
| I | Top 5 curation cards | Task 7 |
| J | Préfiltrage pré-IA | Task 1 |
| K | Indicateur fraîcheur `--stale` | Task 5 + Task 7 |
| L1 | Tableau 8 colonnes | Task 5 |
| L2 | Header dynamique | Task 5 + Task 6 |
| L3 | DPE coloré | Task 5 |
| L4 | Menu ⋯ scan complet | Task 4 (HTML) + Task 6 (wiring) |
| L5 | Stats chiffres 1.5rem | Task 5 |
| L6 | Filtres accordion hover | Task 5 |
| M1 | Header → workspace-hero-card | Task 4 |
| M2 | Boutons → classes globales | Task 6 |
| M3 | Stats → workspace-hero-mini-card | Task 6 |
| M4 | Typography tokens | Task 4 |
| M5 | Progress bar → card standard | Task 4 |
| M6 | Empty state cohérence | Task 4 |

### Type/name consistency

- `_getScannerRayonKm()` used in Tasks 6, 8 — defined once in Task 6
- `_renderFreshnessLabel()` defined in Task 5, used in Task 5 table rows
- `_updateScannerHeaderSub()` defined in Task 5 L2 step, called in Task 6
- `baisseLabel`/`baisseDateLabel` added to `_buildScannerSummaryRow` in Task 3, used in Task 5 table rows — must ensure Task 3 is completed before Task 5's table rendering is tested end-to-end
- `_COMMUNE_COORDS` static fallback: covers ~6 CPs. Good enough for MVP; DB `geocodes` table is future work.

### ⚠ Important notes for executor

1. `scraper/config.py` is gitignored — never commit it. Only edit locally.
2. The `#scanner-progress` show/hide is currently driven by `document.getElementById('scanner-progress').style.display`. After Task 4 (M5 wrap), the outer `#scanner-progress-wrap` controls visibility. Search for all occurrences of `'scanner-progress'` in scanner.js and update the visibility toggle target.
3. The `btn-scan-full` element moves from the main button row to the options dropdown. The `_bindButtons` function currently binds it by ID — this still works after the HTML change since the ID is preserved.
4. The `btn-clear-cache` is also in the dropdown after Task 4. Its handler in `_bindButtons` still works by ID.
5. After Task 4 replaces `scanner-btn--primary` with `btn btn--primary` on the main scan button, verify the `_updateScanButtonsState` function still selects the right elements via `document.getElementById('btn-scan')` (it does — it's by ID, not class).
