# Scanner — Dark mode, scan feedback, matrice loyer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corriger le dark mode du scanner, améliorer le feedback du scan, et afficher la matrice de loyers médians après chaque scan.

**Architecture:**
- `styles.css` : overrides `html[data-theme='dark']` pour les éléments scanner avec backgrounds rgba blanc hardcodés
- `server.py` : nouvel endpoint `/api/marche` qui lit `loyers_marche` depuis SQLite
- `scanner.js` : chargement + rendu de la matrice après chaque scan, amélioration feedback bouton
- `index.html` : container `#scanner-marche` pour la section matrice

**Tech Stack:** CSS variables, Flask, SQLite, vanilla JS ESM

---

## Task 1 : Dark mode CSS — backgrounds hardcodés

**Files:**
- Modify: `styles.css`

### Éléments à corriger

| Sélecteur | Propriété actuelle | Fix dark |
|---|---|---|
| `.scanner-log-toggle` | `background: rgba(255,255,255,0.58)` | `var(--surface-strong)` |
| `.scanner-view-tabs` (dans search bar) | `background: rgba(255,255,255,0.58)` | `var(--surface-strong)` |
| `.scanner-active-filters` | `background: rgba(255,255,255,0.62)` | `var(--surface)` |
| `.scanner-meta-chip--muted` | `background: rgba(255,255,255,0.44)` | `var(--surface-strong)` |
| Mobile filter footer | `background: linear-gradient(0deg, rgba(255,255,255,0.98), ...)` | gradient sur `var(--surface)` |

- [ ] **Étape 1 : Ajouter bloc overrides dark dans styles.css**

Chercher la section `html[data-theme='dark']` la plus proche du bas du fichier (vers la ligne 6500+).
Ajouter ce bloc après `.scanner-log-toggle:hover` (ligne ~6490) :

```css
html[data-theme='dark'] .scanner-log-toggle {
    background: var(--surface-strong);
}

html[data-theme='dark'] .scanner-view-tabs {
    background: var(--surface-strong);
}

html[data-theme='dark'] .scanner-active-filters {
    background: var(--surface);
    box-shadow: 0 2px 8px rgba(0,0,0,0.32);
}

html[data-theme='dark'] .scanner-meta-chip--muted {
    background: var(--surface-strong);
}

@media (max-width: 980px) {
    html[data-theme='dark'] .scanner-filter-sidebar .scanner-filter-footer {
        background: linear-gradient(0deg, var(--surface) 60%, transparent);
    }
}
```

- [ ] **Étape 2 : Vérifier visuellement (screenshot dark)**

```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto("http://localhost:8080")
    time.sleep(2)
    page.evaluate("document.getElementById('profile-modal')?.classList.remove('open'); document.body.classList.remove('modal-open')")
    page.evaluate("document.querySelector('[data-target=\"scanner-panel\"]')?.click()")
    time.sleep(1)
    page.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
    time.sleep(0.3)
    page.screenshot(path="test_dark_mode.png")
    browser.close()
```

Résultat attendu : aucun élément blanc visible dans le scanner en dark mode.

---

## Task 2 : Scan — feedback silencieux quand aucune cible

**Files:**
- Modify: `scanner.js`

Le bouton "Lancer un scan" est déjà `disabled` dans le HTML. Mais si le bouton est cliqué quand `_scanTarget` est null (race condition), `_startScan` retourne silencieusement sans feedback. Il faut ajouter un guard visible.

- [ ] **Étape 1 : Ajouter feedback dans `_startScan`**

Localiser la fonction `_startScan` (ligne ~2038).
Remplacer :
```js
async function _startScan(endpoint) {
  if (_scanRunning || !_scanTarget) return;
```
Par :
```js
async function _startScan(endpoint) {
  if (_scanRunning) return;
  if (!_scanTarget) {
    const input = document.getElementById('scan-target-cp-input');
    if (input) { input.focus(); input.select(); }
    return;
  }
```

- [ ] **Étape 2 : Vérifier que la logique ne régresse pas**

Tester manuellement dans le navigateur : sans zone configurée, cliquer "Lancer un scan" → le champ de saisie prend le focus. Avec zone configurée → le scan démarre normalement.

---

## Task 3 : Endpoint `/api/marche`

**Files:**
- Modify: `server.py`

- [ ] **Étape 1 : Ajouter la fonction `_read_marche`**

Localiser la fin de `_read_bien_detail` (vers ligne 400). Ajouter après :

```python
def _read_marche(ville: str = None, code_postal: str = None):
    """Retourne les loyers médians depuis loyers_marche pour une ville donnée."""
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    import db as scraper_db
    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return []

    conn = scraper_db.init_db(db_path)
    try:
        if ville and code_postal:
            rows = conn.execute("""
                SELECT ville, code_postal, type_bien, nb_pieces,
                       surface_min, surface_max, loyer_median, nb_annonces, date_collecte
                FROM loyers_marche
                WHERE code_postal = ?
                ORDER BY type_bien, nb_pieces, surface_min
            """, (code_postal,)).fetchall()
        else:
            rows = conn.execute("""
                SELECT ville, code_postal, type_bien, nb_pieces,
                       surface_min, surface_max, loyer_median, nb_annonces, date_collecte
                FROM loyers_marche
                ORDER BY ville, type_bien, nb_pieces, surface_min
            """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
```

- [ ] **Étape 2 : Ajouter la route `/api/marche`**

Après la route `/api/bien/<int:bien_id>` (ligne ~532) :

```python
@app.route("/api/marche", methods=["GET"])
def api_marche():
    ville = (request.args.get("ville") or "").strip() or None
    code_postal = (request.args.get("code_postal") or "").strip() or None
    rows = _read_marche(ville=ville, code_postal=code_postal)
    return jsonify({"rows": rows})
```

- [ ] **Étape 3 : Vérifier l'endpoint**

```bash
curl "http://localhost:8080/api/marche?code_postal=18100"
```

Résultat attendu : `{"rows": [...]}` (liste vide si pas encore de données marché).

---

## Task 4 : Forcer le recalcul du marché à chaque scan

**Files:**
- Modify: `server.py`

Actuellement `marche_main` n'est appelé que si `marche_stale()` retourne True (TTL 30 jours). On veut le forcer à chaque scan.

- [ ] **Étape 1 : Modifier `_run_scanner` dans server.py**

Localiser dans `_run_scanner` (ligne ~184) le bloc :
```python
        villes_override = [{"ville": ville, "code_postal": code_postal, "dept": (code_postal or "")[:2]}]
        if rayon_km:
            villes_override[0]["rayon_km"] = rayon_km
        _invalidate_results_cache()
        _update_state(running=True, progress=0, log="Scan lancé…", error=None)
        scraper_main.main(villes_override=villes_override, progress_callback=progress_callback)
```

Remplacer par :
```python
        villes_override = [{"ville": ville, "code_postal": code_postal, "dept": (code_postal or "")[:2]}]
        if rayon_km:
            villes_override[0]["rayon_km"] = rayon_km
        _invalidate_results_cache()
        _update_state(running=True, progress=0, log="Scan lancé…", error=None)
        scraper_main.main(
            villes_override=villes_override,
            progress_callback=progress_callback,
            force_marche=True,
        )
```

- [ ] **Étape 2 : Ajouter `force_marche` dans `scraper/main.py`**

Localiser la signature de `main()` dans `scraper/main.py` (vers ligne 100+).
Chercher `def main(` et ajouter le paramètre + logique :

```python
def main(villes_override=None, progress_callback=None, force_marche=False):
```

Puis localiser le bloc marché locatif (vers ligne 110) :
```python
    # ── 1.5 Marché locatif (si stale) ────────────────────────────────────────
    if marche_stale(conn, villes=villes):
```

Remplacer par :
```python
    # ── 1.5 Marché locatif ───────────────────────────────────────────────────
    if force_marche or marche_stale(conn, villes=villes):
```

- [ ] **Étape 3 : Vérifier**

```bash
curl -s -X POST http://localhost:8080/api/scan \
  -H "Content-Type: application/json" \
  -d '{"ville":"Vierzon","code_postal":"18100","rayon_km":5}'
# Attendre fin, puis :
curl -s "http://localhost:8080/api/marche?code_postal=18100" | python -m json.tool | head -30
```

---

## Task 5 : UI matrice loyer dans le scanner

**Files:**
- Modify: `index.html` (container HTML)
- Modify: `scanner.js` (chargement + rendu)
- Modify: `styles.css` (styles matrice)

### 5a — HTML container

- [ ] **Étape 1 : Ajouter container dans index.html**

Localiser dans `index.html` la ligne contenant `id="scanner-stats"` (~ligne 897).
Ajouter après le div `scanner-stats` :

```html
<div id="scanner-marche" class="scanner-marche" style="display:none"></div>
```

### 5b — Styles CSS

- [ ] **Étape 2 : Ajouter les styles dans styles.css**

Ajouter après le bloc `html[data-theme='dark']` ajouté en Task 1 :

```css
/* ── Matrice loyer marché ─────────────────────────────────────────────────── */
.scanner-marche {
    margin: 0 0 16px 0;
}
.scanner-marche__head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
}
.scanner-marche__title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
}
.scanner-marche__meta {
    font-size: 11px;
    color: var(--muted);
}
.scanner-marche__table-wrap {
    overflow-x: auto;
}
.scanner-marche__table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-family: 'IBM Plex Mono', monospace;
}
.scanner-marche__table th {
    text-align: left;
    padding: 6px 10px;
    background: var(--surface-strong);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--muted-strong);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    white-space: nowrap;
}
.scanner-marche__table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text);
    white-space: nowrap;
}
.scanner-marche__table tbody tr:hover td {
    background: var(--surface-hover);
}
.scanner-marche__loyer {
    font-weight: 700;
    color: var(--accent-gold);
}
.scanner-marche__empty {
    font-size: 12px;
    color: var(--muted);
    padding: 8px 0;
}
```

### 5c — JS chargement et rendu

- [ ] **Étape 3 : Ajouter la fonction `_loadMarche` dans scanner.js**

Ajouter après `_loadPendingCount` (vers ligne 2098) :

```js
async function _loadMarche() {
  const container = document.getElementById('scanner-marche');
  if (!container) return;
  try {
    const cp = _scanTarget?.cp || '';
    const ville = _scanTarget?.commune || '';
    const params = cp ? `?code_postal=${encodeURIComponent(cp)}&ville=${encodeURIComponent(ville)}` : '';
    const resp = await fetch(`/api/marche${params}`);
    if (!resp.ok) return;
    const { rows } = await resp.json();
    _renderMarche(rows, container);
  } catch (_) {}
}

function _renderMarche(rows, container) {
  if (!rows || !rows.length) {
    container.style.display = 'none';
    return;
  }

  const dateCollecte = rows[0]?.date_collecte?.slice(0, 10) || '';
  const ville = rows[0]?.ville || '';

  const TYPE_LABELS = { appartement: 'Appt', maison: 'Maison', immeuble: 'Immeuble' };

  const rowsHtml = rows.map(r => {
    const tranche = r.surface_max >= 9999
      ? `${r.surface_min}+ m²`
      : `${r.surface_min}–${r.surface_max} m²`;
    const typeLabel = TYPE_LABELS[r.type_bien] || r.type_bien;
    const piecesLabel = r.nb_pieces ? `T${r.nb_pieces}` : '—';
    const loyerLabel = r.loyer_median != null
      ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(r.loyer_median) + ' €'
      : '—';
    return `<tr>
      <td>${_esc(typeLabel)}</td>
      <td>${_esc(piecesLabel)}</td>
      <td>${_esc(tranche)}</td>
      <td class="scanner-marche__loyer">${_esc(loyerLabel)}</td>
      <td style="color:var(--muted)">${r.nb_annonces}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="scanner-marche__head">
      <span class="scanner-marche__title">Marché locatif — ${_esc(ville)}</span>
      <span class="scanner-marche__meta">collecté le ${_esc(dateCollecte)} · loyers médians / mois</span>
    </div>
    <div class="scanner-marche__table-wrap">
      <table class="scanner-marche__table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Pièces</th>
            <th>Surface</th>
            <th>Loyer médian</th>
            <th>Annonces</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  container.style.display = '';
}
```

- [ ] **Étape 4 : Appeler `_loadMarche` au bon moment**

Dans `initScanner` (ligne ~1458), ajouter `_loadMarche()` après `_loadPendingCount()` :
```js
export function initScanner({ saveCurrentStudy } = {}) {
  _saveCurrentStudy = saveCurrentStudy || null;
  _syncMissingScanThresholdControl();
  _bindButtons();
  _renderScannerHero();
  _loadResults(false);
  _loadPendingCount();
  _loadMarche();   // ← ajouter
}
```

Dans `onScannerTabActivated` (ligne ~1467), ajouter aussi :
```js
export function onScannerTabActivated() {
  _syncMissingScanThresholdControl();
  _renderScannerHero();
  _loadResults(false);
  _loadPendingCount();
  _loadMarche();   // ← ajouter
  if (_scanRunning) _startPolling();
}
```

Dans `_pollStatus` (ligne ~2113), après `_loadPendingCount()` sur fin de scan :
```js
        _setStatus('done', 'Terminé · ' + _fmtDatetime(data.last_run));
        _showProgress(false);
        await _loadResults(true);
        await _loadPendingCount();
        await _loadMarche();   // ← ajouter
```

- [ ] **Étape 5 : Vérifier visuellement**

Screenshot avec données marché (nécessite un scan réel avec LeBonCoin) :
```bash
curl -s "http://localhost:8080/api/marche?code_postal=18100"
```
Si vide : injecter des données test directement en SQLite pour vérifier l'affichage.

---

## Task 6 : Nettoyage screenshots de test

- [ ] **Supprimer les screenshots Playwright temporaires**

```bash
rm -f screenshot_scanner_light.png screenshot_scanner_dark.png \
      ss_scanner_light.png ss_scanner_dark.png \
      ss_scanner_light3.png ss_scanner_dark3.png \
      test_dark_mode.png
```
