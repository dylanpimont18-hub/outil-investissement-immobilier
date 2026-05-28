# Scanner — Sélection CP obligatoire avant scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forcer la saisie d'un code postal avant de lancer le scan, et restreindre le scraping à cette seule ville.

**Architecture:** Nouveau champ CP avec autocomplétion dans le header du scanner (header-left). `_scanTarget` stocke la ville/CP sélectionnée. Les boutons scan sont désactivés tant que `_scanTarget` est null. Le CP est envoyé dans le body POST → `server.py` valide et passe `villes_override` au scraper → `scraper/main.py` scrape uniquement cette ville. Après scan réussi, le filtre CP de la barre de résultats est auto-rempli.

**Tech Stack:** Vanilla JS ES modules, Flask (Python), SQLite, communes_centre_val.json

---

## File Map

| Fichier | Modification |
|---|---|
| `scraper/main.py` | Ajouter paramètre `villes_override=None` à `main()` |
| `server.py` | Lire `ville`/`code_postal` du body POST, 400 si absent, passer à `_run_scanner` |
| `index.html` | Groupe CP dans `.scanner-header-left`, attribut `disabled` sur boutons scan |
| `scanner.js` | État `_scanTarget`, `_initScanTargetSelector`, `_setScanTarget`, `_updateScanButtonsState`, modifier `_startScan` et `_pollStatus` |

---

## Task 1 — `scraper/main.py` : paramètre `villes_override`

**Files:**
- Modify: `scraper/main.py`

- [ ] **Step 1 : Ajouter `villes_override` à la signature de `main()`**

Dans `scraper/main.py`, remplacer la ligne 65 :

```python
# AVANT
def main(progress_callback=None):

# APRÈS
def main(progress_callback=None, villes_override=None):
```

- [ ] **Step 2 : Utiliser `villes_override` si fourni**

Ajouter une ligne juste après la définition de `_emit` (après la ligne `if progress_callback: ...`), avant le premier `_emit(0, ...)` :

```python
    villes = villes_override if villes_override else VILLES
```

- [ ] **Step 3 : Remplacer les deux usages de `VILLES` dans la fonction**

Ligne 74 : `_emit(0, f"Villes cibles   : {len(VILLES)}")` → `_emit(0, f"Villes cibles   : {len(villes)}")`

Ligne 106 : `annonces = scraper.fetch_all(VILLES)` → `annonces = scraper.fetch_all(villes)`

- [ ] **Step 4 : Vérification manuelle**

Ouvrir `scraper/main.py` et confirmer :
- `def main(progress_callback=None, villes_override=None):`
- `villes = villes_override if villes_override else VILLES` est présent juste après la fermeture de `_emit`
- Plus aucune occurrence de `VILLES` dans le corps de `main()` (seul `from config import VILLES` reste en haut du fichier)

Commande de vérification :
```
python -c "import sys; sys.path.insert(0,'scraper'); from main import main; print('OK')"
```
Attendu : `OK` (pas d'erreur d'import)

- [ ] **Step 5 : Commit**

```bash
git add scraper/main.py
git commit -m "feat(scraper): add villes_override param to main()"
```

---

## Task 2 — `server.py` : lire CP du body POST et passer au scraper

**Files:**
- Modify: `server.py` (fonctions `api_scan`, `api_scan_full`, `_run_scanner`)

- [ ] **Step 1 : Modifier `_run_scanner` pour accepter `ville` et `code_postal`**

Remplacer la signature de `_run_scanner` :

```python
# AVANT
def _run_scanner(full: bool):

# APRÈS
def _run_scanner(full: bool, ville: str = None, code_postal: str = None):
```

- [ ] **Step 2 : Construire `villes_override` et le passer au scraper**

Dans `_run_scanner`, juste avant la ligne `_update_state(running=True, ...)`, ajouter :

```python
        villes_override = [{"ville": ville, "code_postal": code_postal, "dept": code_postal[:2]}]
```

Puis modifier l'appel à `scraper_main.main` :

```python
# AVANT
        scraper_main.main(progress_callback=progress_callback)

# APRÈS
        scraper_main.main(villes_override=villes_override, progress_callback=progress_callback)
```

- [ ] **Step 3 : Modifier `api_scan()` pour lire et valider le body**

Remplacer le corps de `api_scan()` :

```python
@app.route("/api/scan", methods=["POST"])
def api_scan():
    data = request.get_json(force=True, silent=True) or {}
    ville = (data.get("ville") or "").strip()
    code_postal = (data.get("code_postal") or "").strip()
    if not ville or not code_postal:
        return jsonify({"error": "ville_required"}), 400

    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(False, ville, code_postal), daemon=True)
    t.start()
    return jsonify({"started": True})
```

- [ ] **Step 4 : Modifier `api_scan_full()` de la même façon**

```python
@app.route("/api/scan/full", methods=["POST"])
def api_scan_full():
    data = request.get_json(force=True, silent=True) or {}
    ville = (data.get("ville") or "").strip()
    code_postal = (data.get("code_postal") or "").strip()
    if not ville or not code_postal:
        return jsonify({"error": "ville_required"}), 400

    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(True, ville, code_postal), daemon=True)
    t.start()
    return jsonify({"started": True, "db_cleared": True})
```

- [ ] **Step 5 : Vérification manuelle**

Démarrer le serveur : `python server.py`

Test 1 — POST sans body → doit retourner 400 :
```bash
curl -s -X POST http://localhost:8080/api/scan -H "Content-Type: application/json" -d "{}"
```
Attendu : `{"error": "ville_required"}`

Test 2 — POST avec body valide → doit retourner 200 :
```bash
curl -s -X POST http://localhost:8080/api/scan -H "Content-Type: application/json" -d "{\"ville\":\"Bourges\",\"code_postal\":\"18000\"}"
```
Attendu : `{"started": true}`

Arrêter le serveur (Ctrl+C).

- [ ] **Step 6 : Commit**

```bash
git add server.py
git commit -m "feat(server): require ville/code_postal in POST /api/scan"
```

---

## Task 3 — `index.html` : groupe CP dans header-left + boutons disabled

**Files:**
- Modify: `index.html`

- [ ] **Step 1 : Ajouter le groupe CP dans `.scanner-header-left`**

Dans `index.html`, localiser le bloc `.scanner-header-left` (autour de la ligne 643). Ajouter après `<p id="scanner-header-sub" class="scanner-header-sub">Centre-Val de Loire</p>` :

```html
              <div class="scanner-target-cp-group" style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
                <span style="font-size:12px;color:var(--muted)">Zone :</span>
                <div style="position:relative">
                  <input id="scan-target-cp-input" type="text" placeholder="Code postal ou ville…"
                    autocomplete="off"
                    style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-strong);color:var(--text);font-size:13px;width:210px;font-family:inherit">
                  <div id="scan-target-cp-dropdown" style="display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:280px;z-index:200;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:220px;overflow-y:auto"></div>
                </div>
                <span id="scan-target-cp-badge" style="display:none;padding:3px 10px;background:rgba(197,160,89,0.15);color:var(--accent-gold);border:1px solid rgba(197,160,89,0.3);border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap"></span>
                <button id="scan-target-cp-reset" style="display:none;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:11px;cursor:pointer;font-family:inherit">× Réinit.</button>
              </div>
```

- [ ] **Step 2 : Ajouter `disabled` aux boutons scan dans `.scanner-header-right`**

Localiser les deux boutons (autour de la ligne 655) et ajouter l'attribut `disabled` :

```html
<!-- AVANT -->
<button id="btn-scan-full" class="scanner-btn scanner-btn--outline">↺ Scan complet</button>
<button id="btn-scan" class="scanner-btn scanner-btn--primary">▶ Lancer un scan</button>

<!-- APRÈS -->
<button id="btn-scan-full" class="scanner-btn scanner-btn--outline" disabled>↺ Scan complet</button>
<button id="btn-scan" class="scanner-btn scanner-btn--primary" disabled>▶ Lancer un scan</button>
```

- [ ] **Step 3 : Vérification manuelle**

Ouvrir `http://localhost:8080` dans le navigateur, onglet Scanner.  
Attendu : les boutons "Lancer un scan" et "Scan complet" apparaissent grisés/désactivés. Le champ "Zone :" apparaît dans le header-left sous le titre.

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat(scanner/html): add pre-scan CP group in header, disable scan buttons"
```

---

## Task 4 — `scanner.js` : état `_scanTarget`, init, set, reset, state control

**Files:**
- Modify: `scanner.js`

- [ ] **Step 1 : Ajouter la variable d'état `_scanTarget`**

Dans `scanner.js`, localiser la section `─── État scanner ───` (autour de la ligne 160). Ajouter après `let _saveCurrentStudy = null;` :

```js
let _scanTarget = null; // { cp, commune, label } — ville cible du prochain scan
```

- [ ] **Step 2 : Ajouter `_setScanTarget()`**

Après la fonction `_setCPFilter` (autour de la ligne 147), ajouter :

```js
function _setScanTarget(cp, commune, label) {
  _scanTarget = { cp, commune, label };
  const badge = document.getElementById('scan-target-cp-badge');
  const reset = document.getElementById('scan-target-cp-reset');
  if (badge) { badge.textContent = label; badge.style.display = ''; }
  if (reset) reset.style.display = '';
  const input = document.getElementById('scan-target-cp-input');
  if (input) input.value = label;
  _updateScanButtonsState();
}
```

- [ ] **Step 3 : Ajouter `_updateScanButtonsState()`**

Juste après `_setScanTarget`, ajouter :

```js
function _updateScanButtonsState() {
  const canScan = !!_scanTarget && !_scanRunning;
  ['btn-scan', 'btn-scan-full'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !canScan;
  });
  const input = document.getElementById('scan-target-cp-input');
  const reset = document.getElementById('scan-target-cp-reset');
  if (input) input.disabled = _scanRunning;
  if (reset) reset.style.display = (_scanTarget && !_scanRunning) ? '' : 'none';
}
```

- [ ] **Step 4 : Modifier `_setButtonsDisabled` pour déléguer à `_updateScanButtonsState`**

Remplacer le corps de `_setButtonsDisabled` :

```js
// AVANT
function _setButtonsDisabled(disabled) {
  ['btn-scan', 'btn-scan-full', 'btn-clear-cache'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// APRÈS
function _setButtonsDisabled(disabled) {
  const btn = document.getElementById('btn-clear-cache');
  if (btn) btn.disabled = disabled;
  _updateScanButtonsState();
}
```

- [ ] **Step 5 : Ajouter `_initScanTargetSelector()`**

Ajouter la fonction après `_initCPSelector` (autour de la ligne 137) :

```js
function _initScanTargetSelector() {
  const input = document.getElementById('scan-target-cp-input');
  const dropdown = document.getElementById('scan-target-cp-dropdown');
  const resetBtn = document.getElementById('scan-target-cp-reset');
  if (!input) return;

  input.addEventListener('focus', () => _loadCommunesData());

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (val.length < 2 || !_communesData) { dropdown.style.display = 'none'; return; }

    const matches = [];
    const valLow = val.toLowerCase();
    for (const [cp, communes] of Object.entries(_communesData)) {
      if (cp.startsWith(val)) {
        for (const commune of communes) matches.push({ cp, commune });
      } else {
        for (const commune of communes) {
          if (commune.toLowerCase().includes(valLow)) matches.push({ cp, commune });
        }
      }
    }

    if (!matches.length) { dropdown.style.display = 'none'; return; }

    let html = '';
    for (const { cp, commune } of matches.slice(0, 30)) {
      html += `<div class="cp-option" data-cp="${cp}" data-commune="${_esc(commune)}"
        style="padding:8px 14px;cursor:pointer;font-size:13px">
        <span style="color:var(--muted);font-size:11px;margin-right:6px">${cp}</span>${_esc(commune)}
      </div>`;
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.cp-option').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--surface-strong)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
      el.addEventListener('click', () => {
        _setScanTarget(el.dataset.cp, el.dataset.commune, `${el.dataset.cp} — ${el.dataset.commune}`);
        dropdown.style.display = 'none';
      });
    });
  });

  input.addEventListener('keydown', e => {
    const options = [...dropdown.querySelectorAll('.cp-option')];
    const active = dropdown.querySelector('.cp-option--active');
    const idx = options.indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = options[idx + 1] || options[0];
      if (active) { active.classList.remove('cp-option--active'); active.style.background = ''; }
      if (next) { next.classList.add('cp-option--active'); next.style.background = 'var(--surface-strong)'; }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = options[idx - 1] || options[options.length - 1];
      if (active) { active.classList.remove('cp-option--active'); active.style.background = ''; }
      if (prev) { prev.classList.add('cp-option--active'); prev.style.background = 'var(--surface-strong)'; }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = active || options[0];
      if (target) {
        _setScanTarget(target.dataset.cp, target.dataset.commune, `${target.dataset.cp} — ${target.dataset.commune}`);
        dropdown.style.display = 'none';
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  resetBtn?.addEventListener('click', () => {
    _scanTarget = null;
    input.value = '';
    const badge = document.getElementById('scan-target-cp-badge');
    if (badge) badge.style.display = 'none';
    resetBtn.style.display = 'none';
    _updateScanButtonsState();
  });
}
```

- [ ] **Step 6 : Appeler `_initScanTargetSelector()` dans `_bindButtons()`**

Dans `_bindButtons()`, à la suite de `_initCPSelector()` (autour de la ligne 260), ajouter :

```js
  _initScanTargetSelector();
```

- [ ] **Step 7 : Vérification manuelle**

Ouvrir `http://localhost:8080`, onglet Scanner.  
1. Taper "18" dans le champ "Zone :" → un dropdown de communes doit apparaître.  
2. Sélectionner "18000 — Bourges" → le badge "18000 — Bourges" apparaît, les boutons "Lancer un scan" et "Scan complet" s'activent.  
3. Cliquer "× Réinit." → badge disparaît, boutons se désactivent à nouveau.

- [ ] **Step 8 : Commit**

```bash
git add scanner.js
git commit -m "feat(scanner/js): add _scanTarget state, init/set/reset, _updateScanButtonsState"
```

---

## Task 5 — `scanner.js` : envoyer CP dans POST + auto-remplir filtre résultats

**Files:**
- Modify: `scanner.js` (fonctions `_startScan` et `_pollStatus`)

- [ ] **Step 1 : Modifier `_startScan` pour inclure CP dans le body**

Remplacer le corps de `_startScan` :

```js
// AVANT
async function _startScan(endpoint) {
  if (_scanRunning) return;
  try {
    const resp = await fetch(endpoint, { method: 'POST' });
    if (resp.status === 409) { alert('Un scan est déjà en cours.'); return; }
    if (!resp.ok) throw new Error(await resp.text());
    _scanRunning = true;
    _setButtonsDisabled(true);
    _showProgress(true);
    _setStatus('running', 'Scan en cours…');
    _startPolling();
  } catch (e) {
    alert('Erreur au démarrage du scan : ' + e.message);
  }
}

// APRÈS
async function _startScan(endpoint) {
  if (_scanRunning || !_scanTarget) return;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code_postal: _scanTarget.cp, ville: _scanTarget.commune }),
    });
    if (resp.status === 409) { alert('Un scan est déjà en cours.'); return; }
    if (!resp.ok) throw new Error(await resp.text());
    _scanRunning = true;
    _setButtonsDisabled(true);
    _showProgress(true);
    _setStatus('running', 'Scan en cours…');
    _startPolling();
  } catch (e) {
    alert('Erreur au démarrage du scan : ' + e.message);
  }
}
```

- [ ] **Step 2 : Modifier `_pollStatus` pour auto-remplir le filtre CP après scan**

Dans `_pollStatus`, localiser le bloc `if (!data.running)`. Après la ligne `await _loadResults(true);`, ajouter le pré-remplissage du filtre CP :

```js
// AVANT (dans le bloc if (!data.running) { ... })
        _setStatus('done', 'Terminé · ' + _fmtDatetime(data.last_run));
        _showProgress(false);
        await _loadResults(true);

// APRÈS
        _setStatus('done', 'Terminé · ' + _fmtDatetime(data.last_run));
        _showProgress(false);
        await _loadResults(true);
        if (_scanTarget) {
          _setCPFilter(_scanTarget.cp, _scanTarget.commune, _scanTarget.label);
        }
```

- [ ] **Step 3 : Vérification manuelle (intégration complète)**

Démarrer le serveur : `python server.py` (ou `python app.py`).

1. Onglet Scanner → champ "Zone :" → taper "18000" → sélectionner "18000 — Bourges".
2. Badge "18000 — Bourges" visible, boutons scan actifs.
3. Cliquer "▶ Lancer un scan".
4. Vérifier dans le terminal du serveur que le scraper tourne uniquement pour Bourges (log : `Villes cibles : 1`).
5. Attendre la fin du scan → vérifier que la barre de recherche affiche "18000 — Bourges" pré-rempli dans le filtre CP.
6. Vérifier que les résultats affichés correspondent à Bourges.
7. Tenter de cliquer "Lancer un scan" sans CP sélectionné (après réinit.) → doit être grisé, aucun effet.

- [ ] **Step 4 : Commit**

```bash
git add scanner.js
git commit -m "feat(scanner/js): send CP in scan POST, auto-fill result filter after scan"
```

---

## Récapitulatif des commits

1. `feat(scraper): add villes_override param to main()`
2. `feat(server): require ville/code_postal in POST /api/scan`
3. `feat(scanner/html): add pre-scan CP group in header, disable scan buttons`
4. `feat(scanner/js): add _scanTarget state, init/set/reset, _updateScanButtonsState`
5. `feat(scanner/js): send CP in scan POST, auto-fill result filter after scan`
