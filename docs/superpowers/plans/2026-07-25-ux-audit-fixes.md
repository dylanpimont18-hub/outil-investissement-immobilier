# Corrections UX (Vue rapide, étude vierge, skip profil) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire la densité de la page Analyse en Vue rapide, faire démarrer une nouvelle étude sans verdict fabriqué, et ajouter un échappatoire au modal Profil bloquant.

**Architecture:** Changements CSS/HTML/JS ciblés, sans nouvelle dépendance. Le mécanisme `data-analysis-view="quick"|"full"` déjà en place (main.js `_applyAnalysisView`) est étendu côté CSS. `calculs.js` n'est pas touché (reste pur, sans notion d'affichage).

**Tech Stack:** HTML/CSS/JS vanilla, Flask (serveur statique, aucun changement serveur dans ce plan), Playwright (Python) pour la vérification visuelle — pas de framework de test JS dans ce projet.

## Global Constraints

- Tout texte utilisateur reste en français.
- `calculs.js` reste pur (pas de DOM, pas de `localStorage`, pas de `window`) — aucune tâche de ce plan n'y touche.
- Chaque tâche se vérifie en conditions réelles (serveur Flask lancé + Playwright), pas seulement en relisant le code — convention déjà établie sur ce projet.
- Aucun `git push` — commits locaux uniquement.

## Vérification — mise en place commune

Toutes les tâches de ce plan se vérifient avec le même serveur de dev. Avant la première tâche :

```bash
cd "c:/Users/Dylan/Desktop/Creation_site/Investissement_web"
python server.py > /tmp/spark_server.log 2>&1 &
# attendre qu'il réponde :
timeout 20 bash -c 'until curl -sf http://127.0.0.1:8080 >/dev/null; do sleep 1; done' && echo UP
```

Pour l'arrêter à la fin de la session de travail :
```bash
netstat -ano | grep ":8080" | grep LISTENING   # note le PID en dernière colonne
powershell -NoProfile -Command "Stop-Process -Id <PID> -Force"
```

Chaque tâche ci-dessous fournit un script Playwright autonome (`python <script>.py`) qui pilote une vraie page Chromium contre ce serveur — c'est le "test" de ce plan (pas de framework JS de test dans ce projet).

---

### Task 1: Étendre le masquage "Vue rapide" et convertir les sections avancées en `<details>` repliables

**Files:**
- Modify: `index.html:546-634`
- Modify: `styles.css:8777-8782` (règles de masquage existantes) et ajout après ligne 8782
- Test: script Playwright ad hoc (voir Step 3)

**Interfaces:**
- Consomme : l'attribut `data-analysis-view` déjà posé sur `#analysis-panel` par `_applyAnalysisView()` (main.js, inchangé dans cette tâche).
- Produit : classes CSS `.analysis-section--visuals`, `.analysis-section--robustesse`, `.analysis-section--scenarios`, `.analysis-section--regime`, `.analysis-section--forward` (déjà existante sous le nom `.analysis-forward`, inchangée), `.analysis-section--cashflow` (déjà existante, inchangée), `.analysis-section--journal`, `.analysis-columns--action` — utilisées uniquement par le CSS de cette tâche, aucune tâche suivante n'en dépend.

- [ ] **Step 1: Remplacer le bloc HTML `index.html:546-634`**

Remplacer intégralement (du `<div class="analysis-visuals">` au `</section>` fermant `#analysis-panel`) par :

```html
                        <div class="analysis-visuals analysis-section--visuals">
                            <section class="analysis-block">
                                <h4>Répartition mensuelle</h4>
                                <div id="analysis-monthly-chart"></div>
                            </section>

                            <section class="analysis-block">
                                <h4>Structure du coût d entrée</h4>
                                <div id="analysis-cost-chart"></div>
                            </section>
                        </div>

                        <div id="analysis-anchor-robustesse" class="analysis-section-badge">③ ROBUSTESSE</div>
                        <div class="analysis-columns--2up">
                            <details class="analysis-block analysis-section--robustesse">
                                <summary>Solidité des hypothèses</summary>
                                <div id="analysis-confidence"></div>
                            </details>

                        </div>

                        <details class="analysis-block analysis-section--robustesse">
                            <summary>Vue détaillée</summary>
                            <div id="analysis-details"></div>
                        </details>

                        <div id="analysis-anchor-scenarios" class="analysis-section-badge">④ SCÉNARIOS &amp; PROJECTIONS</div>
                        <div class="analysis-columns--2up">
                            <details class="analysis-block analysis-section--scenarios">
                                <summary>Scénarios de stress</summary>
                                <div id="analysis-scenarios"></div>
                            </details>

                            <details class="analysis-block analysis-section--sensitivity">
                                <summary>Comparatif des leviers</summary>
                                <div id="analysis-sensitivity-table"></div>
                            </details>
                        </div>

                        <div class="analysis-forward">
                            <details class="analysis-block analysis-block--wide">
                                <summary>
                                    Projection à 10 ans
                                    <p class="analysis-block-note">Sans revente : cash-flow cumulé, capital remboursé et valeur créée sur un horizon de 10 ans.</p>
                                </summary>
                                <div id="analysis-timeline-chart"></div>
                            </details>

                            <details class="analysis-block analysis-block--wide">
                                <summary>
                                    Matrice prix / loyer
                                    <p class="analysis-block-note">Lecture directe du couple prix / loyer avec signal Acheter, Négocier ou Refuser selon l économie du dossier.</p>
                                </summary>
                                <div id="analysis-price-rent-matrix"></div>
                            </details>
                        </div>

                        <details class="analysis-block analysis-section--regime">
                            <summary>Régimes fiscaux</summary>
                            <div id="analysis-regime-table"></div>
                        </details>

                        <details class="analysis-block analysis-block--wide analysis-section--cashflow">
                            <summary>
                                Cash-flow annuel sur la durée du prêt
                                <p class="analysis-block-note">CF avant impôt et après impôt (en €/mois) pour chaque année du financement.</p>
                            </summary>
                            <div id="analysis-cashflow-table"></div>
                        </details>

                        <div id="analysis-anchor-action" class="analysis-section-badge">⑤ PLAN D'ACTION</div>
                        <div class="analysis-columns--2up analysis-columns--action">
                            <details class="analysis-block analysis-section--journal">
                                <summary>Journal de décision</summary>
                                <div id="analysis-journal"></div>
                            </details>

                            <section class="analysis-block">
                                <h4>Leviers prioritaires</h4>
                                <div id="analysis-action-plan"></div>
                            </section>
                        </div>
                    </section>
```

Notes :
- `.analysis-forward` garde son nom de classe existant (déjà ciblé par le CSS de masquage "quick" actuel) — pas besoin de la renommer.
- `.analysis-section--sensitivity` et `.analysis-section--cashflow` gardent aussi leurs noms actuels (déjà dans le CSS existant).
- `id="analysis-confidence"`, `id="analysis-details"`, etc. restent identiques — `main.js` cible ces ids en `innerHTML`, aucun changement JS nécessaire dans cette tâche.

- [ ] **Step 2: Étendre les règles CSS de masquage + ajouter le style des `<summary>`**

Dans `styles.css`, remplacer les lignes 8777-8782 :

```css
/* Sections masquées en Vue rapide */
#analysis-panel[data-analysis-view="quick"] .analysis-forward,
#analysis-panel[data-analysis-view="quick"] .analysis-section--sensitivity,
#analysis-panel[data-analysis-view="quick"] .analysis-section--cashflow {
    display: none;
}
```

par :

```css
/* Sections masquées en Vue rapide */
#analysis-panel[data-analysis-view="quick"] .analysis-forward,
#analysis-panel[data-analysis-view="quick"] .analysis-section--sensitivity,
#analysis-panel[data-analysis-view="quick"] .analysis-section--cashflow,
#analysis-panel[data-analysis-view="quick"] .analysis-section--visuals,
#analysis-panel[data-analysis-view="quick"] .analysis-section--robustesse,
#analysis-panel[data-analysis-view="quick"] .analysis-section--scenarios,
#analysis-panel[data-analysis-view="quick"] .analysis-section--regime,
#analysis-panel[data-analysis-view="quick"] .analysis-section--journal {
    display: none;
}

/* Grille 2 colonnes → 1 colonne quand un des deux enfants est masqué en Vue rapide */
#analysis-panel[data-analysis-view="quick"] .analysis-columns--action {
    grid-template-columns: 1fr;
}

/* Style des <summary> des sections repliables (habillage identique aux anciens <h4>) */
.analysis-block > summary {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    color: var(--accent-gold);
    text-transform: uppercase;
    cursor: pointer;
    list-style: none;
}
.analysis-block > summary::-webkit-details-marker { display: none; }
.analysis-block[open] > summary { margin-bottom: 14px; }
.analysis-block > summary .analysis-block-note {
    text-transform: none;
    letter-spacing: normal;
    font-family: var(--font-body);
    color: var(--muted);
    margin-top: 4px;
}
```

- [ ] **Step 3: Vérifier en conditions réelles**

Écrire `verify_task1.py` (à la racine du projet ou dans un dossier scratch) :

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto("http://127.0.0.1:8080", wait_until="networkidle")
    page.click("#profile-save", timeout=3000)
    page.wait_for_timeout(300)

    quick_height = page.evaluate("document.body.scrollHeight")
    assert quick_height < 4000, f"Vue rapide encore trop haute : {quick_height}px"

    # Robustesse/Scénarios/Régimes/Journal doivent être invisibles en quick
    for sel in ["#analysis-confidence", "#analysis-scenarios", "#analysis-regime-table", "#analysis-journal"]:
        visible = page.is_visible(sel)
        assert not visible, f"{sel} ne devrait pas être visible en Vue rapide"

    # Leviers prioritaires doit rester visible en quick
    assert page.is_visible("#analysis-action-plan"), "Leviers prioritaires doit rester visible en Vue rapide"

    page.click("#btn-view-full")
    page.wait_for_timeout(300)
    for sel in ["#analysis-confidence", "#analysis-scenarios", "#analysis-regime-table", "#analysis-journal"]:
        assert page.is_visible(sel), f"{sel} doit exister en Vue complète (dans un <details> fermé)"
        is_open = page.eval_on_selector(sel, "el => el.closest('details')?.open") 
        assert not is_open, f"{sel} doit être fermé par défaut en Vue complète"

    print(f"OK — hauteur Vue rapide : {quick_height}px (était ~7508px avant)")
    browser.close()
```

Run: `python verify_task1.py`
Expected: `OK — hauteur Vue rapide : <valeur> px (était ~7508px avant)` sans AssertionError.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat(analyse): condense la Vue rapide, sections avancées en details repliables"
```

---

### Task 2: Étude vierge par défaut (prix/loyer/travaux/meubles/loyer-marché à 0)

**Files:**
- Modify: `main.js:300-340` (`VARIABLE_DEFAULTS`)
- Test: script Playwright ad hoc (voir Step 2)

**Interfaces:**
- Consomme : rien de nouveau.
- Produit : `VARIABLE_DEFAULTS.prix === 0`, `.loyer === 0`, `.travaux === 0`, `.meubles === 0`, `['loyer-marche'] === 0` — consommés par Task 3 (état neutre).

- [ ] **Step 1: Modifier `VARIABLE_DEFAULTS`**

Dans `main.js`, remplacer :

```js
    prix: 107000,
    nego: 0,
    loyer: 700,
    notaire: 8,
    travaux: 5000,
    meubles: 4000,
    agence: 0,
```

par :

```js
    prix: 0,
    nego: 0,
    loyer: 0,
    notaire: 8,
    travaux: 0,
    meubles: 0,
    agence: 0,
```

Et remplacer :

```js
    'loyer-marche': 700,
```

par :

```js
    'loyer-marche': 0,
```

(Les autres clés — `notaire`, `apport`, `taux-input`, `duree`, `assurance`, `frais-bancaires`, `vacance`, `copro`, `fonciere`, `pno`, `gestion`, seuils, `dpe`, `regime`, sources — ne changent pas.)

- [ ] **Step 2: Vérifier en conditions réelles**

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto("http://127.0.0.1:8080", wait_until="networkidle")
    page.click("#profile-save", timeout=3000)
    page.wait_for_timeout(300)

    prix_val = page.input_value("#prix")
    loyer_val = page.input_value("#loyer")
    assert prix_val in ("0", ""), f"prix par défaut devrait être vide/0, trouvé: {prix_val!r}"
    assert loyer_val in ("0", ""), f"loyer par défaut devrait être vide/0, trouvé: {loyer_val!r}"
    print("OK — prix et loyer démarrent à 0")
    browser.close()
```

Run: `python verify_task2.py`
Expected: `OK — prix et loyer démarrent à 0`

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(analyse): étude vierge par défaut (prix/loyer/travaux non pré-remplis)"
```

---

### Task 3: État neutre tant que prix/loyer sont vides

**Files:**
- Modify: `main.js:1300` (`buildWorkspaceHero`), `main.js:2937` (`buildAnalysisStickySummary`), `main.js:2984` (`buildAnalysisAcquisitionDecision`) — les 3 fonctions confirmées qui injectent respectivement dans `nodes.workspaceHero`, `nodes.analysisStickySummary`, `nodes.analysisAcquisitionDecision` (nœuds déjà déclarés lignes 507, 559, 560)
- Modify: `styles.css` (nouvelle classe `.analysis-neutral-card`, à ajouter après le bloc `.analysis-block` ~ligne 1639)
- Test: script Playwright ad hoc (voir Step 4)

**Interfaces:**
- Consomme : `state.variablesData.prix`, `state.variablesData.loyer` (déjà lus ailleurs dans `main.js` de la même façon).
- Produit : `isEssentialDataMissing()` et `buildNeutralAnalysisPlaceholder()`, deux nouvelles fonctions internes à `main.js`, utilisées par les 3 fonctions ci-dessus.

- [ ] **Step 1: Ajouter les deux fonctions partagées**

Juste avant `function buildWorkspaceHero(...)` (`main.js:1300`), ajouter :

```js
function isEssentialDataMissing() {
    const prix = Number(state.variablesData?.prix) || 0;
    const loyer = Number(state.variablesData?.loyer) || 0;
    return prix <= 0 || loyer <= 0;
}

function buildNeutralAnalysisPlaceholder() {
    return `
        <div class="analysis-neutral-card">
            <h2>Renseignez le prix et le loyer</h2>
            <p>L'analyse démarre dès que le prix affiché et le loyer cible sont renseignés dans le formulaire ci-dessous.</p>
        </div>
    `;
}
```

- [ ] **Step 2: Garder chacune des 3 fonctions de rendu**

Dans `buildWorkspaceHero` (`main.js:1300`), juste après la garde existante `if (!nodes.workspaceHero) { return; }` (ligne ~1303), ajouter :

```js
    if (isEssentialDataMissing()) {
        nodes.workspaceHero.innerHTML = buildNeutralAnalysisPlaceholder();
        return;
    }
```

Dans `buildAnalysisStickySummary` (`main.js:2937`), en toute première ligne du corps de fonction, ajouter :

```js
    if (isEssentialDataMissing()) {
        nodes.analysisStickySummary.innerHTML = buildNeutralAnalysisPlaceholder();
        return;
    }
```

Dans `buildAnalysisAcquisitionDecision` (`main.js:2984`), en toute première ligne du corps de fonction, ajouter :

```js
    if (isEssentialDataMissing()) {
        nodes.analysisAcquisitionDecision.innerHTML = buildNeutralAnalysisPlaceholder();
        return;
    }
```

- [ ] **Step 3: Styliser `.analysis-neutral-card`**

Ajouter dans `styles.css`, à la suite du bloc `.analysis-block` (~ligne 1639) :

```css
.analysis-neutral-card {
    padding: 32px 24px;
    text-align: center;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    color: var(--muted);
}
.analysis-neutral-card h2 {
    font-size: 1.1rem;
    color: var(--text);
    margin-bottom: 8px;
}
```

- [ ] **Step 4: Vérifier en conditions réelles**

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto("http://127.0.0.1:8080", wait_until="networkidle")
    page.click("#profile-save", timeout=3000)
    page.wait_for_timeout(300)

    hero_text = page.inner_text("#workspace-hero")
    assert "Offre non recevable" not in hero_text, "Le verdict fabriqué ne devrait plus apparaître sur une étude vierge"
    assert "Renseignez le prix et le loyer" in hero_text, "L'état neutre devrait être affiché"

    page.fill("#prix", "150000")
    page.fill("#loyer", "800")
    page.dispatch_event("#loyer", "change")
    page.wait_for_timeout(300)
    hero_text_after = page.inner_text("#workspace-hero")
    assert "Renseignez le prix et le loyer" not in hero_text_after, "Une fois prix/loyer saisis, le verdict calculé doit s'afficher"
    print("OK — état neutre avant saisie, verdict calculé après")
    browser.close()
```

Run: `python verify_task3.py`
Expected: `OK — état neutre avant saisie, verdict calculé après`

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat(analyse): état neutre tant que prix/loyer ne sont pas renseignés"
```

---

### Task 4: Échappatoire "Plus tard" sur le modal Profil

**Files:**
- Modify: `index.html:1183` (ajout du bouton)
- Modify: `main.js` (handler du bouton + handler Escape, autour de `closeProfileModal`/`canDismissProfileModal` ~ligne 2609-2664, et du listener Escape ~ligne 6649-6653)
- Test: script Playwright ad hoc (voir Step 4)

**Interfaces:**
- Consomme : `dismissProfileModal()` (déjà exportée en interne, inchangée).
- Produit : nouvelle fonction `skipProfileModal()` dans `main.js`, appelée par le bouton `#profile-skip` et par le handler Escape.

- [ ] **Step 1: Ajouter le bouton dans `index.html`**

Remplacer la ligne 1183 :

```html
                        <button type="button" id="profile-close" class="modal-close" aria-label="Fermer la fenêtre profil">Fermer</button>
```

par :

```html
                        <button type="button" id="profile-close" class="modal-close" aria-label="Fermer la fenêtre profil">Fermer</button>
                        <button type="button" id="profile-skip" class="modal-close" aria-label="Configurer le profil plus tard">Plus tard</button>
```

- [ ] **Step 2: Ajouter le nœud, la fonction `skipProfileModal`, et le handler du bouton dans `main.js`**

Dans l'objet `nodes` (chercher `profileClose: document.getElementById('profile-close'),` ~ligne 594), ajouter juste après :

```js
    profileSkip: document.getElementById('profile-skip'),
```

Après la fonction `closeProfileModal()` (~ligne 2664), ajouter :

```js
function skipProfileModal() {
    dismissProfileModal();
}
```

Là où `nodes.profileClose.addEventListener('click', () => closeProfileModal());` est câblé (~ligne 6633), ajouter juste après :

```js
    nodes.profileSkip?.addEventListener('click', () => skipProfileModal());
```

Dans la fonction qui synchronise l'affichage du modal (chercher `nodes.profileClose.hidden = !state.profileConfigured;` ~ligne 6387), ajouter juste après :

```js
    if (nodes.profileSkip) nodes.profileSkip.hidden = state.profileConfigured;
```

(Le bouton "Plus tard" est visible seulement tant que le profil n'est pas configuré ; le bouton "Fermer" reste cousin, visible seulement une fois configuré — comportement inchangé pour "Fermer".)

- [ ] **Step 3: Faire pointer Escape vers le skip**

Chercher le bloc (~ligne 6649-6653) :

```js
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.isProfileModalOpen) {
            closeProfileModal();
            return;
        }
```

Remplacer par :

```js
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.isProfileModalOpen) {
            skipProfileModal();
            return;
        }
```

- [ ] **Step 4: Vérifier en conditions réelles**

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto("http://127.0.0.1:8080", wait_until="networkidle")

    assert page.is_visible("#profile-modal.open, #profile-modal[aria-hidden='false']") or page.is_visible("#profile-skip"), "Le modal profil devrait être ouvert au premier lancement"
    page.click("#profile-skip")
    page.wait_for_timeout(300)
    assert page.get_attribute("#profile-modal", "aria-hidden") == "true", "Le modal doit se fermer après clic sur Plus tard"

    # Le badge topbar doit rester "pending"
    topbar_meta = page.inner_text("#topbar-profile-meta")
    assert "Configuration requise" in topbar_meta, "Le badge doit rester en attente après skip"
    print("OK — Plus tard ferme le modal sans marquer le profil configuré")
    browser.close()
```

Run: `python verify_task4.py`
Expected: `OK — Plus tard ferme le modal sans marquer le profil configuré`

- [ ] **Step 5: Commit**

```bash
git add index.html main.js
git commit -m "feat(profil): bouton Plus tard pour passer le modal profil au premier lancement"
```

---

## Self-Review (fait pendant l'écriture de ce plan)

- **Couverture spec** : Task 1 couvre §2 (Vue rapide condensée + `<details>` repliables), Task 2+3 couvrent §3a/3b (étude vierge + état neutre), Task 4 couvre §3c (skip profil). Le point "sticky sidebar" du spec est marqué "déjà corrigé" en préambule — pas de tâche dédiée.
- **Pas de placeholder** : chaque step contient le code exact à écrire, pas de "TODO"/"similar to".
- **Cohérence des noms** : `skipProfileModal()` défini en Task 4 Step 2, utilisé Step 2 et Step 3 du même task — cohérent. Task 3 renvoie sur des noms `nodes.workspaceHero` etc. à vérifier/adapter au moment de l'implémentation car la fonction exacte n'a pas été localisée à l'écriture de ce plan (dépendance signalée explicitement au Step 1 de Task 3, pas un TODO caché — c'est une étape de recherche à exécuter, avec une commande grep exacte fournie).
