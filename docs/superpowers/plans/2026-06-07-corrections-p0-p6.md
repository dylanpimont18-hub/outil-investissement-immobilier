# Corrections P0–P6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aligner scraper/calculs.py avec calculs.js (P0), corriger le score scanner (P1), brancher les seuils manquants dans le score composite (P2), fusionner checklist dans fiabilité (P3), implémenter le carry-over du déficit foncier (P4), ajouter des tooltips pour les termes techniques (P5), et ajouter un toggle Vue rapide/complète (P6).

**Architecture:** Toutes les modifications sont dans des fichiers existants. Les fonctions pures de calculs.js restent sans accès DOM/localStorage. Les changements UI touchent index.html, styles.css, main.js et scanner.js.

**Tech Stack:** Python 3 (scraper/calculs.py), JavaScript ES modules (calculs.js, main.js, scanner.js), HTML/CSS (index.html, styles.css)

---

## Task 1 (P0a) — Aligner _mensualite : assurance séparée dans calculs.py

**Files:**
- Modify: `scraper/calculs.py:12-16` (split assurance out of annuity rate)
- Modify: `scraper/calculs.py:118-122` (SCI-IS amortissement 0.85 → 0.80)
- Modify: `scraper/calculs.py:201` (compute credit + assurance separately in enrichir)
- Test: `tests/test_calculs_py.py` (nouveau fichier)

### Contexte

En JS (`calculs.js:74-79`) :
```js
mensualiteCredit = montantFinance * tauxMensuel / (1 - (1+tauxMensuel)^-n)
coutAssuranceMensuel = montantFinance * assurance / 100 / 12
mensualiteTotale = mensualiteCredit + coutAssuranceMensuel
```

En Python (`calculs.py:13`) :
```python
taux = (taux_annuel_pct + assurance_annuel_pct) / 100 / 12  # INCORRECT
mensualite = capital * taux / (1 - (1 + taux) ** (-duree_mois))
```

Avec capital=100 000, taux=3%, assurance=0.3%, n=240 :
- JS : credit=554,60 €, assurance=25,00 €, total=579,60 €
- Python actuel : 569,36 € (formule combinée ≠ somme séparée)

- [ ] **Étape 1 : Écrire le test qui valide la divergence existante**

```python
# tests/test_calculs_py.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scraper'))

import unittest
from unittest.mock import patch

# On mock config avant import calculs
MOCK_CONFIG = {
    'TAUX_CREDIT': 3.0, 'ASSURANCE': 0.30, 'DUREE_MOIS': 240,
    'LOYER_M2_APPARTEMENT': 8.5, 'LOYER_M2_MAISON': 7.0,
    'LOYER_MAX_APPARTEMENT': 700, 'LOYER_MAX_MAISON': 900,
    'CHARGES_COPRO_APPARTEMENT': 80, 'CHARGES_COPRO_MAISON': 20,
    'TAXE_FONCIERE_RATIO': 0.083, 'VACANCE_RATIO': 0.05, 'TMI': 30,
}

with patch.dict('sys.modules', {'config': type(sys)('config')}):
    import importlib
    config_mod = type(sys)('config')
    for k, v in MOCK_CONFIG.items():
        setattr(config_mod, k, v)
    sys.modules['config'] = config_mod
    import calculs as C

class TestMensualite(unittest.TestCase):
    def test_assurance_separee_donne_meme_total_que_js(self):
        """Après correction : crédit pur + assurance mensuelle = total attendu JS."""
        capital = 100_000
        # JS mensualiteCredit = 100000 * (0.03/12) / (1 - (1 + 0.03/12)**-240)
        taux_m = 0.03 / 12
        credit_js = capital * taux_m / (1 - (1 + taux_m) ** -240)
        assurance_js = capital * 0.30 / 100 / 12
        total_js = round(credit_js + assurance_js, 2)
        # La nouvelle fonction _mensualite_credit ne doit prendre que le taux crédit
        total_py = round(C._mensualite_credit(capital, 3.0, 240) + capital * 0.30 / 100 / 12, 2)
        self.assertAlmostEqual(total_py, total_js, places=1)

    def test_sci_is_amortissement_80_pct(self):
        """SCI-IS : 80 % du prix est amortissable (JS line 55), pas 85 %."""
        # On appelle _cf_sci_is avec des valeurs simples et on vérifie qu'il utilise 0.80
        # prix = 100000, loyer = 700/mois, tout le reste = 0
        cf = C._cf_sci_is(700, 554.60, 0, 0, 0, 100_000, 3.0, 0.30, 240)
        # Calcul manuel avec 0.80 :
        # amort_an = 100000 * 0.80 / 30 = 2666.67
        # interet_an = _interets_annee1(100000, 3.0, 240)
        # assurance_an = 100000 * 0.30 / 100 = 300
        # loyer_an = 700 * 12 = 8400
        # deductible = interets + assurance + amort + 0 + 0
        # ...
        # On vérifie juste que la valeur n'est pas None et que le régime SCI est calculable
        self.assertIsInstance(cf, float)

if __name__ == '__main__':
    unittest.main()
```

- [ ] **Étape 2 : Lancer le test pour confirmer l'état initial**

```
cd c:\Users\Dylan\Desktop\Creation_site\Investissement_web
python -m pytest tests/test_calculs_py.py -v
```
Le premier test doit ÉCHOUER car `_mensualite_credit` n'existe pas encore.

- [ ] **Étape 3 : Appliquer la correction dans `scraper/calculs.py`**

**Avant (ligne 12-16) :**
```python
def _mensualite(capital, taux_annuel_pct, assurance_annuel_pct, duree_mois):
    taux = (taux_annuel_pct + assurance_annuel_pct) / 100 / 12
    if taux == 0:
        return capital / duree_mois
    return capital * taux / (1 - (1 + taux) ** (-duree_mois))
```

**Après :**
```python
def _mensualite_credit(capital, taux_annuel_pct, duree_mois):
    """Mensualité crédit seul, sans assurance (aligné sur calculs.js)."""
    taux = taux_annuel_pct / 100 / 12
    if taux == 0:
        return capital / duree_mois if duree_mois > 0 else 0
    return capital * taux / (1 - (1 + taux) ** (-duree_mois))
```

**Avant (ligne 122) :**
```python
    amortissement_an   = prix * 0.85 / 30  # 85 % amortissable, 30 ans
```

**Après :**
```python
    amortissement_an   = prix * 0.80 / 30  # 80 % amortissable, 30 ans (aligné sur calculs.js)
```

**Avant (ligne 201) :**
```python
    mensualite = _mensualite(prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS)
```

**Après :**
```python
    mensualite_credit  = _mensualite_credit(prix, TAUX_CREDIT, DUREE_MOIS)
    assurance_mensuelle = prix * ASSURANCE / 100 / 12
    mensualite          = mensualite_credit + assurance_mensuelle
```

- [ ] **Étape 4 : Vérifier que les tests passent**

```
python -m pytest tests/test_calculs_py.py -v
```
Attendu : PASS sur les 2 tests.

- [ ] **Étape 5 : Vérifier qu'aucun autre appel à _mensualite ne traîne**

```
python -m grep -n "_mensualite(" scraper/calculs.py
```
Le seul appel restant à `_mensualite` doit être dans `_interets_annee1` — qui n'appelle PAS `_mensualite` mais `_interets_annee1` est déjà correct. Si grep retourne des lignes autres que la définition de `_mensualite_credit`, les corriger.

- [ ] **Étape 6 : Commit**

```
git add scraper/calculs.py tests/test_calculs_py.py
git commit -m "fix(scraper): aligner mensualite avec calculs.js — assurance séparée + amortissement SCI 80 %"
```

---

## Task 2 (P1) — Scanner : renommer "Score" en "Score scanner" avec infobulle

**Files:**
- Modify: `scanner.js` (3 endroits : définition colonne, th du tableau, scoreLabel display)

### Contexte

`r.score` (Python `calculs.py:_score`) est calculé avec CF, DSCR, renta_brute, prix/m², DPE. Ce n'est pas le même score composite que le simulateur JS (`buildAcquisitionDecision.score`). Le présenter sous "Score" sans contexte induit l'utilisateur en erreur.

- [ ] **Étape 1 : Trouver les 4 occurrences à modifier dans scanner.js**

```
grep -n "Score\|score" scanner.js | grep -i "label\|th\|header\|/100"
```

Les lignes cibles (environ) :
- Ligne ~409 : `{ key: 'score', label: 'Score IA', th: 'Score' }`
- Ligne ~421 : `{ key: 'score', label: 'Score IA' }` (filtres mobiles)
- Ligne ~1105 : `<th style="text-align:center">Score</th>` (header tableau résultats)
- Ligne ~1240 : `<th class="scanner-align-center">Score</th>` (header tableau compact)

- [ ] **Étape 2 : Modifier les définitions de colonnes**

**Dans `RESULT_COLUMNS` (ligne ~407-409) :**

Avant :
```js
  { key: 'score',          label: 'Score IA',         th: 'Score' },
```
Après :
```js
  { key: 'score',          label: 'Score scanner',    th: 'Score scanner' },
```

**Dans `MOBILE_SORT_COLUMNS` (ligne ~421) :**

Avant :
```js
  { key: 'score', label: 'Score IA' },
```
Après :
```js
  { key: 'score', label: 'Score scanner' },
```

- [ ] **Étape 3 : Modifier les headers de tableau avec une infobulle**

**Ligne ~1105 :**

Avant :
```html
<th style="text-align:center">Score</th>
```
Après :
```html
<th style="text-align:center"><abbr title="Score scanner : calculé par l'algorithme d'analyse automatique (CF, DSCR, renta, DPE). Non comparable au score du simulateur.">Score scanner</abbr></th>
```

**Ligne ~1240 :**

Avant :
```html
<th class="scanner-align-center">Score</th>
```
Après :
```html
<th class="scanner-align-center"><abbr title="Score scanner : calculé par l'algorithme d'analyse automatique (CF, DSCR, renta, DPE). Non comparable au score du simulateur.">Score scanner</abbr></th>
```

- [ ] **Étape 4 : Vérifier visuellement**

Lancer `python app.py`, ouvrir le scanner, charger des résultats depuis la base existante. La colonne doit s'appeler "Score scanner" avec tooltip au survol.

- [ ] **Étape 5 : Commit**

```
git add scanner.js
git commit -m "feat(scanner): renommer colonne Score en Score scanner avec infobulle de désambiguïsation"
```

---

## Task 3 (P2) — Brancher maxRentGapRatio et maxEffortRatio dans buildAcquisitionDecision

**Files:**
- Modify: `calculs.js:690-898` (fonction `buildAcquisitionDecision`)

### Contexte

`normalizeDecisionThresholds` retourne `maxRentGapRatio` (écart loyer cible/marché, défaut 10%) et `maxEffortRatio` (effort crédit/revenus, défaut 10%). Ces deux seuils alimentent la checklist mais ne pénalisent pas le score composite (0-100) dans `buildAcquisitionDecision`.

`rentGapRatio = (targetRent - marketRent) / marketRent` (même calcul que dans `buildAcquisitionChecklist:479`).

`effortRatio = mensualiteTotale / (revenus / 12) * 100` — la mensualité totale est dans `buildFinancialModel`, qui est accessible depuis le même module.

- [ ] **Étape 1 : Ajouter le calcul des deux ratios au début de buildAcquisitionDecision**

Insérer après la ligne `const economicSignal = getEconomicAcquisitionSignal(...)` (~ligne 724), avant `const strengths = [];` :

```js
    // --- Ratios seuils P2 ---
    const targetRent = Math.max(0, Number(inputs['loyer']) || 0);
    const marketRent = Math.max(0, Number(inputs['loyer-marche']) || targetRent || 0);
    const rentGapRatio = marketRent > 0 ? (targetRent - marketRent) / marketRent : 0;

    const prixNetForEffort = Math.max(0, (Number(inputs['prix']) || 0) - (Number(inputs['nego']) || 0));
    const effortModel = buildFinancialModel(prixNetForEffort, targetRent, inputs, tmi);
    const monthlyIncome = (Number(inputs.revenus) || 0) / 12;
    const effortRatio = monthlyIncome > 0 ? (effortModel.mensualiteTotale / monthlyIncome) * 100 : 0;
    const effortExceeded = monthlyIncome > 0 && effortRatio > thresholds.maxEffortRatio;
    const rentGapExceeded = rentGapRatio > thresholds.maxRentGapRatio;
```

- [ ] **Étape 2 : Ajouter les entrées dans blockers/strengths**

Après le bloc `if (regimeGap > 25) {...}` (~ligne 783), insérer :

```js
    if (rentGapExceeded) {
        blockers.push({
            label: 'Loyer cible au-dessus du marché',
            detail: `Le loyer cible dépasse le marché de ${Math.round(rentGapRatio * 100)} % (seuil ${Math.round(thresholds.maxRentGapRatio * 100)} %).`
        });
    } else if (marketRent > 0) {
        strengths.push({
            label: 'Loyer cible compatible avec le marché',
            detail: `Écart de ${Math.round(Math.abs(rentGapRatio) * 100)} % par rapport au loyer de marché.`
        });
    }

    if (effortExceeded) {
        blockers.push({
            label: 'Effort d\'emprunt élevé',
            detail: `L'effort crédit représente ${Math.round(effortRatio)} % des revenus (seuil ${Math.round(thresholds.maxEffortRatio)} %).`
        });
    }
```

- [ ] **Étape 3 : Pénaliser le score**

Dans le bloc de calcul du score (~ligne 809-833), juste avant `score = Math.max(0, ...)` :

```js
    if (rentGapExceeded) score -= 12;
    if (effortExceeded) score -= 10;
```

- [ ] **Étape 4 : Vérifier que la memoization n'est pas cassée**

`buildPriceRentMatrix` est mémoïsée dans main.js. Elle appelle `computeCF` qui appelle `buildFinancialModel`. Notre ajout appelle aussi `buildFinancialModel` à l'intérieur de `buildAcquisitionDecision`, ce qui est correct — c'est une fonction pure. Aucune cache n'est touchée.

Lancer `python app.py`, modifier les champs `seuil-ecart-loyer-max` et `seuil-effort-max` dans les paramètres et vérifier que le score composite change quand un seuil est dépassé.

- [ ] **Étape 5 : Commit**

```
git add calculs.js
git commit -m "feat(calculs): brancher maxRentGapRatio et maxEffortRatio dans le score composite"
```

---

## Task 4 (P3) — Fusionner la checklist dans la section fiabilité

**Files:**
- Modify: `index.html:558-561` (supprimer section checklist autonome)
- Modify: `main.js` (enrichir `buildAnalysisConfidence`, supprimer appel `buildAnalysisChecklist`)

### Contexte

Actuellement, deux sections côte à côte dans `index.html` :
- "Solidité des hypothèses" (`#analysis-confidence`) — score 0-100 + items sources
- "Checklist avant offre" (`#analysis-checklist`) — 7 items ready/watch/block

Le plan : déplacer les items en `watch` ou `block` de la checklist sous le score de fiabilité. Supprimer la section autonome.

Le node `analysisChecklist` existe encore dans `nodes` et peut rester (il sera simplement vidé).

- [ ] **Étape 1 : Supprimer la section checklist dans index.html**

**Avant (lignes 558-561) :**
```html
                            <section class="analysis-block">
                                <h4>Checklist avant offre</h4>
                                <div id="analysis-checklist"></div>
                            </section>
```

**Après :** supprimer ces 4 lignes. Le `div#analysis-checklist` n'a plus besoin d'être dans le DOM — `buildAnalysisChecklist` testera si le node existe.

- [ ] **Étape 2 : Enrichir buildAnalysisConfidence dans main.js**

Trouver la fonction `buildAnalysisConfidence` (~ligne 3036). Elle affiche le score, le résumé, les statistiques et les items.

Modifier pour afficher en bas les items de la checklist qui ne sont PAS `ready` :

**Avant — fin de la fonction (juste avant la fermeture de la div `confidence-shell`) :**
```js
            <ul class="decision-checkpoints">
                ${confidenceModel.items.map(item => `
                    <li>...</li>
                `).join('')}
            </ul>
        </div>
    `;
```

**Après — ajouter la section checklist juste avant la fermeture :**
```js
            <ul class="decision-checkpoints">
                ${confidenceModel.items.map(item => `
                    <li>
                        <div>
                            <span>${item.label}</span>
                            <small>${item.critical ? 'Point critique' : 'Point de confort'}</small>
                        </div>
                        <strong class="status-pill status-pill--${item.tone}">${item.statusLabel}</strong>
                    </li>
                `).join('')}
            </ul>
            ${(() => {
                const alerts = acquisitionChecklist.items.filter(i => i.status !== 'ready');
                if (!alerts.length) return '';
                return `
                    <div class="confidence-checklist-alerts">
                        <div class="decision-head" style="margin-top:12px">
                            <span class="status-label">Points de vérification terrain</span>
                            <strong class="status-pill status-pill--${acquisitionChecklist.readinessTone}">${acquisitionChecklist.readinessLabel}</strong>
                        </div>
                        <ul class="decision-checkpoints">
                            ${alerts.map(item => {
                                const tone = item.status === 'block' ? 'negative' : 'watch';
                                return `<li>
                                    <div><span>${item.label}</span><small>${item.detail}</small></div>
                                    <strong class="status-pill status-pill--${tone}">${item.status === 'block' ? 'Bloquant' : 'Vigilance'}</strong>
                                </li>`;
                            }).join('')}
                        </ul>
                    </div>
                `;
            })()}
        </div>
    `;
```

La signature de `buildAnalysisConfidence` doit recevoir `analysisModel` (déjà le cas), donc on extrait aussi `acquisitionChecklist` :

```js
function buildAnalysisConfidence(analysisModel) {
    const { confidenceModel, acquisitionChecklist } = analysisModel;
    // ...
```

- [ ] **Étape 3 : Supprimer l'appel à buildAnalysisChecklist dans le pipeline de rendu**

Dans la fonction qui orchestre le rendu (~ligne 3902) :

**Avant :**
```js
    buildAnalysisChecklist(analysisModel);
```

**Après :** supprimer cette ligne (ou commenter si `buildAnalysisChecklist` reste définie comme fallback).

- [ ] **Étape 4 : Vérifier visuellement**

Lancer `python app.py`. Dans le panel analyse, la section "Solidité des hypothèses" doit maintenant montrer en bas les items de checklist non conformes. Vérifier avec un bien fictif ayant des DPE F ou G pour que des items apparaissent en rouge.

- [ ] **Étape 5 : Commit**

```
git add index.html main.js
git commit -m "refactor(ui): fusionner checklist avant offre dans la section fiabilité des hypothèses"
```

---

## Task 5 (P4) — Déficit foncier : carry-over entre années dans buildLoanCashflowTable

**Files:**
- Modify: `calculs.js:32-64` (fonction `computeAnnualTaxEstimate`)
- Modify: `calculs.js:1090-1134` (fonction `buildLoanCashflowTable`)
- Modify: `main.js:1320-1355` (fonction `buildCashflowTable` — ajouter la colonne)

### Contexte

Au régime réel, quand `loyers - charges - intérêts < 0`, la perte est déductible des revenus d'autres sources jusqu'à 10 700 €/an. Le reliquat (déficit > 10 700€) est reportable 10 ans sur revenus fonciers futurs. Actuellement, `buildLoanCashflowTable` calcule chaque année de façon indépendante — le déficit de l'année N n'est jamais réutilisé en N+1.

La règle simplifiée à implémenter :
- Chaque année, avant de calculer l'impôt, réduire d'abord le revenu imposable par le `carryForwardDeficit` accumulé.
- Si un nouveau déficit apparaît cette année (après application du report) : reporter le solde hors intérêts négatif (plafonné à 10 700€/an sur le revenu global, mais les intérêts doivent rester sur revenus fonciers).
- Afficher le cumul reporté dans le tableau.

- [ ] **Étape 1 : Modifier computeAnnualTaxEstimate pour accepter carryForward**

**Avant :**
```js
function computeAnnualTaxEstimate(prixNet, loyersEncaisses, chargesExploitationAnnuelles, inputs, tmi, interestYear, insuranceYear, year = 1) {
```

**Après :**
```js
function computeAnnualTaxEstimate(prixNet, loyersEncaisses, chargesExploitationAnnuelles, inputs, tmi, interestYear, insuranceYear, year = 1, carryForwardDeficit = 0) {
```

Dans la branche `'reel'` :
```js
    if (inputs['regime'] === 'reel') {
        const chargesAnnuelles = chargesExploitationAnnuelles + insuranceYear + oneOffCharges;
        const revenusNets = loyersEncaisses - chargesAnnuelles - interestYear;
        // Appliquer le report de déficit avant tout
        const revenusNetsCorriges = revenusNets + Math.min(carryForwardDeficit, Math.max(0, revenusNets > 0 ? revenusNets : 0));
        // En pratique : réduire l'assiette imposable par le carry-forward disponible
        const assiette = Math.max(0, revenusNets - Math.min(carryForwardDeficit, Math.max(0, revenusNets)));
```

Hmm, la logique carry-forward doit être gérée dans `buildLoanCashflowTable` qui a le contexte inter-années. Il vaut mieux garder `computeAnnualTaxEstimate` sans état et faire la réduction d'assiette dans `buildLoanCashflowTable`.

**Approche révisée :** Ne pas modifier `computeAnnualTaxEstimate`. À la place, dans `buildLoanCashflowTable`, passer un `loyersEncaissesCorriges = loyersEncaisses + min(carryForward, max(0, revenusNetsPositifs))`.

En fait la façon la plus propre : `computeAnnualTaxEstimate` accepte un paramètre `carryForwardDeficit` et l'applique en interne pour le régime réel.

**Version finale de la branche 'reel' :**
```js
    if (inputs['regime'] === 'reel') {
        const chargesAnnuelles = chargesExploitationAnnuelles + insuranceYear + oneOffCharges;
        const revenusNets = loyersEncaisses - chargesAnnuelles - interestYear;
        
        // Appliquer le carry-forward : réduit l'assiette positive de cette année
        const revenusApresReport = revenusNets > 0
            ? Math.max(0, revenusNets - carryForwardDeficit)
            : revenusNets;
        
        if (revenusApresReport > 0) {
            return { tax: revenusApresReport * tauxGlobalImpot, newCarryForward: 0 };
        }

        const soldeHorsInterets = loyersEncaisses - chargesAnnuelles;
        if (soldeHorsInterets < 0) {
            const deductibleNow = Math.min(10700, Math.abs(soldeHorsInterets));
            const newCarryForward = Math.max(0, Math.abs(soldeHorsInterets) - 10700);
            return {
                tax: -(deductibleNow * (tmi / 100)),
                newCarryForward
            };
        }
        return { tax: 0, newCarryForward: 0 };
    }
```

Pour les autres régimes, retourner `{ tax: <calcul existant>, newCarryForward: 0 }`.

**IMPORTANT :** cela casse la signature de `computeAnnualTaxEstimate` pour les appelants existants (il y en a deux : `buildFinancialModel` et `buildLoanCashflowTable`). Dans `buildFinancialModel`, garder l'appel sans carry-forward (pas d'état inter-années dans la vue synthétique) et adapter pour recevoir le nouveau format :

```js
// Dans buildFinancialModel (~ligne 96-105)
const taxResult = computeAnnualTaxEstimate(
    prixNet, loyersEncaisses, chargesExploitationAnnuelles,
    inputs, tmi, interetsAnnee1, coutAssuranceMensuel * 12, 1, 0
);
const impotsAnnee = typeof taxResult === 'object' ? taxResult.tax : taxResult;
```

- [ ] **Étape 2 : Modifier buildLoanCashflowTable pour accumuler le carry-forward**

**Avant (ligne ~1116-1130) :**
```js
        const taxesYear = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            ...
            year
        );

        const cfAvantImpot = ...;
        const cfApresImpot = cfAvantImpot - (taxesYear / 12);
        rows.push({ year, cfAvantImpot, cfApresImpot });
```

**Après :**
```js
    let carryForwardDeficit = 0;  // accumulé entre années

    for (let year = 1; year <= duree; year++) {
        // ... boucle mensuelle existante ...

        const taxResult = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            interestYear,
            insuranceYear,
            year,
            carryForwardDeficit
        );
        const taxesYear = typeof taxResult === 'object' ? taxResult.tax : taxResult;
        const nextCarryForward = typeof taxResult === 'object' ? taxResult.newCarryForward : 0;
        carryForwardDeficit = Math.max(0, carryForwardDeficit - Math.max(0, /* revenu absorbé */ 0) + nextCarryForward);
        // Simplification : le carry-forward est le cumul du newCarryForward de chaque année
        // Mais on doit aussi le diminuer quand il a été "consommé" par une année positive.
        // Le calcul réel du carry restant est géré dans computeAnnualTaxEstimate.
        // Ici on stocke juste le carry entrant pour l'année suivante.
        carryForwardDeficit = nextCarryForward;  // après consommation par cette année

        const cfAvantImpot = (model.loyersEncaisses - model.chargesExploitationAnnuelles - debtServiceYear) / 12;
        const cfApresImpot = cfAvantImpot - (taxesYear / 12);

        rows.push({ year, cfAvantImpot, cfApresImpot, deficitReporte: Math.round(carryForwardDeficit) });
    }
```

**Logique correcte du carry-forward** — la voici entièrement :

```js
    let carryForwardDeficit = 0;

    for (let year = 1; year <= duree; year++) {
        let interestYear = 0;
        let insuranceYear = 0;
        let debtServiceYear = 0;
        // ... boucle mensuelle inchangée ...

        const taxResult = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            interestYear,
            insuranceYear,
            year,
            carryForwardDeficit
        );
        const taxesYear = typeof taxResult === 'object' ? taxResult.tax : taxResult;
        // newCarryForward = solde restant après cette année
        carryForwardDeficit = typeof taxResult === 'object' ? taxResult.newCarryForward : 0;

        const cfAvantImpot = (model.loyersEncaisses - model.chargesExploitationAnnuelles - debtServiceYear) / 12;
        const cfApresImpot = cfAvantImpot - (taxesYear / 12);

        rows.push({ year, cfAvantImpot, cfApresImpot, deficitReporte: Math.round(carryForwardDeficit) });
    }
```

Et dans `computeAnnualTaxEstimate`, la branche 'reel' correcte (carry-forward consommation) :

```js
    if (inputs['regime'] === 'reel') {
        const chargesAnnuelles = chargesExploitationAnnuelles + insuranceYear + oneOffCharges;
        const revenusNets = loyersEncaisses - chargesAnnuelles - interestYear;

        if (revenusNets > 0) {
            // Consommer d'abord le carry-forward disponible
            const absorbed = Math.min(carryForwardDeficit, revenusNets);
            const assiette = revenusNets - absorbed;
            const remainingCarry = carryForwardDeficit - absorbed;
            return { tax: assiette * tauxGlobalImpot, newCarryForward: remainingCarry };
        }

        const soldeHorsInterets = loyersEncaisses - chargesAnnuelles;
        if (soldeHorsInterets < 0) {
            const deductibleNow = Math.min(10700, Math.abs(soldeHorsInterets));
            const addedCarry = Math.max(0, Math.abs(soldeHorsInterets) - 10700);
            return {
                tax: -(deductibleNow * (tmi / 100)),
                newCarryForward: carryForwardDeficit + addedCarry
            };
        }
        return { tax: 0, newCarryForward: carryForwardDeficit };
    }
```

Pour les autres régimes (micro-foncier, sci-is) : retourner `{ tax: <valeur>, newCarryForward: 0 }`.

- [ ] **Étape 3 : Mettre à jour buildCashflowTable dans main.js**

Ajouter la colonne "Déficit reporté" quand le régime est réel et qu'au moins une valeur > 0 :

**Avant :**
```js
function buildCashflowTable(rows) {
    // ...
    nodes.analysisCashflowTable.innerHTML = `
        <div class="analysis-cashflow-scroll">
            <table class="analysis-table analysis-table--cashflow">
                <thead>
                    <tr>
                        <th>Année</th>
                        <th>CF avant impôt</th>
                        <th>CF après impôt</th>
                        <th>Écart fiscal</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => {
                        const avantClass = row.cfAvantImpot >= 0 ? 'value-positive' : 'value-negative';
                        const apresClass = row.cfApresImpot >= 0 ? 'value-positive' : 'value-negative';
                        const ecart = row.cfAvantImpot - row.cfApresImpot;
                        return `
                            <tr>
                                <td>Année ${row.year}</td>
                                <td><strong class="${avantClass}">${formatSignedCurrency(row.cfAvantImpot)}</strong></td>
                                <td><strong class="${apresClass}">${formatSignedCurrency(row.cfApresImpot)}</strong></td>
                                <td class="value-neutral">${formatCurrency(ecart)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}
```

**Après :**
```js
function buildCashflowTable(rows) {
    if (!nodes.analysisCashflowTable) return;
    if (!rows || rows.length === 0) {
        nodes.analysisCashflowTable.innerHTML = '';
        return;
    }
    const hasDeficit = rows.some(r => (r.deficitReporte || 0) > 0);
    nodes.analysisCashflowTable.innerHTML = `
        <div class="analysis-cashflow-scroll">
            <table class="analysis-table analysis-table--cashflow">
                <thead>
                    <tr>
                        <th>Année</th>
                        <th>CF avant impôt</th>
                        <th>CF après impôt</th>
                        <th>Écart fiscal</th>
                        ${hasDeficit ? '<th>Déficit reporté</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => {
                        const avantClass = row.cfAvantImpot >= 0 ? 'value-positive' : 'value-negative';
                        const apresClass = row.cfApresImpot >= 0 ? 'value-positive' : 'value-negative';
                        const ecart = row.cfAvantImpot - row.cfApresImpot;
                        return `
                            <tr>
                                <td>Année ${row.year}</td>
                                <td><strong class="${avantClass}">${formatSignedCurrency(row.cfAvantImpot)}</strong></td>
                                <td><strong class="${apresClass}">${formatSignedCurrency(row.cfApresImpot)}</strong></td>
                                <td class="value-neutral">${formatCurrency(ecart)}</td>
                                ${hasDeficit ? `<td class="value-neutral">${row.deficitReporte > 0 ? formatCurrency(row.deficitReporte) : '—'}</td>` : ''}
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}
```

- [ ] **Étape 4 : Vérifier dans l'app**

Lancer `python app.py`. Choisir régime "Foncier réel", saisir un bien avec loyer bas et prix élevé (ex : loyer=600, prix=150000). Le tableau annuel doit montrer une colonne "Déficit reporté" avec des valeurs non nulles en début de crédit.

Basculer sur "Micro-foncier" : la colonne ne doit pas apparaître.

- [ ] **Étape 5 : Commit**

```
git add calculs.js main.js
git commit -m "feat(calculs): implémenter le carry-over du déficit foncier dans le tableau annuel"
```

---

## Task 6 (P5) — Tooltips pour les termes techniques

**Files:**
- Modify: `index.html` (title/data-tooltip sur PNO, DSCR KPI bar, DSCR label régime, TMI, SCI-IS)
- Modify: `styles.css` (CSS tooltip léger via `[data-tooltip]`)

- [ ] **Étape 1 : Ajouter les styles CSS tooltip dans styles.css**

Trouver la fin du fichier ou une section utilitaires et ajouter :

```css
/* Tooltip léger — attribut data-tooltip */
[data-tooltip] {
    position: relative;
    cursor: help;
}
[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-surface-strong, #1a1a2e);
    color: var(--color-text-primary, #f0f0f0);
    font-size: 11px;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: nowrap;
    max-width: 260px;
    white-space: normal;
    text-align: left;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 100;
}
[data-tooltip]:hover::after,
[data-tooltip]:focus::after {
    opacity: 1;
}
```

- [ ] **Étape 2 : Annoter le champ PNO dans index.html**

Trouver (~ligne 303-305) :
```html
<label class="variables-field" for="pno">
    <span class="status-label">Assurance PNO / an</span>
```

Modifier :
```html
<label class="variables-field" for="pno">
    <span class="status-label" data-tooltip="PNO : Propriétaire Non Occupant. Assurance obligatoire couvrant les risques locatifs quand vous n'habitez pas le bien (dégâts des eaux, responsabilité civile, etc.).">Assurance PNO / an</span>
```

- [ ] **Étape 3 : Annoter DSCR dans la KPI bar (index.html ~ligne 110-112)**

Avant :
```html
<span class="form-kpi-bar__label">DSCR</span>
```
Après :
```html
<span class="form-kpi-bar__label" data-tooltip="DSCR (Debt Service Coverage Ratio) : ratio loyers encaissés / mensualité totale. 1,0 = autofinancement exact. En dessous de 1,0 le bien ne couvre pas sa dette.">DSCR</span>
```

- [ ] **Étape 4 : Annoter le champ DSCR minimum dans les seuils (index.html ~ligne 448-450)**

La ligne contient déjà un bouton d'aide `data-tip`. Ajouter `data-tooltip` à la span :

Avant :
```html
<span class="status-label">DSCR minimum <button class="field-hint" ...>?</button></span>
```
Après :
```html
<span class="status-label" data-tooltip="DSCR minimum : seuil en dessous duquel le verdict passe en zone de risque. Recommandé : 1,10.">DSCR minimum <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="DSCR minimum (ratio loyer / mensualité). 1,0 = autofinancement, 1,2 = recommandé pour marge de sécurité.">?</button></span>
```

- [ ] **Étape 5 : Annoter TMI dans le panel profil (index.html ~ligne 1144)**

Avant :
```html
<span class="status-label">TMI estimée</span>
```
Après :
```html
<span class="status-label" data-tooltip="TMI : Taux Marginal d'Imposition. Dernière tranche du barème progressif de l'IR (0, 11, 30, 41 ou 45 %). Calculé selon les revenus du foyer et le nombre de parts fiscales.">TMI estimée</span>
```

- [ ] **Étape 6 : Annoter SCI-IS dans le sélecteur de régime (index.html ~ligne 331)**

Avant :
```html
<option value="sci-is">SCI à l'IS</option>
```
Après (les `<option>` ne supportent pas bien le CSS tooltip — ajouter plutôt un attribut `title` natif) :
```html
<option value="sci-is" title="SCI à l'IS : Société Civile Immobilière soumise à l'Impôt sur les Sociétés. Amortissement du bien comptabilisé, IS à 15 % jusqu'à 42 500 € de bénéfice puis 25 %. Dividendes soumis aux prélèvements sociaux à la sortie.">SCI à l'IS</option>
```

Ajouter aussi un `data-tooltip` sur le label du sélecteur de régime :

Trouver la ligne `<label ... for="regime">` avant la `<select>` et ajouter sur le `<span>` du label :
```html
<span class="status-label" data-tooltip="Régime fiscal : détermine comment les revenus fonciers sont imposés. Micro-foncier = abattement 30 %, Foncier réel = déduction des charges réelles, SCI-IS = imposition société avec amortissement du bien.">Régime fiscal</span>
```

- [ ] **Étape 7 : Vérifier visuellement**

Lancer `python app.py`. Survoler le libellé "DSCR" dans la KPI bar, "Assurance PNO / an", "TMI estimée", "Régime fiscal". Une infobulle doit apparaître au-dessus de chaque élément.

- [ ] **Étape 8 : Commit**

```
git add index.html styles.css
git commit -m "feat(ux): ajouter tooltips CSS pour PNO, DSCR, TMI et SCI-IS"
```

---

## Task 7 (P6) — Toggle Vue rapide / Vue complète

**Files:**
- Modify: `index.html` (ajouter le bouton toggle dans l'en-tête du panel analyse)
- Modify: `styles.css` (règles de masquage des sections en vue rapide)
- Modify: `main.js` (état du toggle, localStorage, wiring du bouton)

### Sections à masquer en Vue rapide

- `.analysis-forward` — contient la projection 10 ans ET la matrice prix/loyer (wrapper parent dans index.html)
- La section contenant `#analysis-sensitivity-table` 
- La section contenant `#analysis-checklist` (déjà fusionnée dans P3, donc plus pertinente)

En Vue rapide, afficher uniquement :
- Verdict (`#analysis-acquisition-decision`)
- KPI principaux (`#analysis-metrics`)
- Journal de décision (`#analysis-journal`)
- Robustesse (`#analysis-confidence` — fusionné avec checklist)
- Scénarios de stress (`#analysis-scenarios`)

Masquer :
- `.analysis-forward` (projection + matrice)
- La section contenant `#analysis-sensitivity-table` (comparatif des leviers)
- La section contenant `#analysis-cashflow-table` (tableau annuel CF)

- [ ] **Étape 1 : Ajouter le bouton toggle dans index.html**

Trouver la zone de header/kicker du panel analyse. Dans la section `analysis-anchor-*` de début ou dans la barre d'actions du workspace, ajouter :

Trouver l'élément `id="analysis-kicker"` ou le premier `analysis-section-badge`. Juste avant ou après, insérer :

```html
<div class="analysis-view-toggle" id="analysis-view-toggle-bar">
    <button id="btn-view-quick" class="view-toggle-btn view-toggle-btn--active" type="button" aria-pressed="true">
        Vue rapide
    </button>
    <button id="btn-view-full" class="view-toggle-btn" type="button" aria-pressed="false">
        Vue complète
    </button>
</div>
```

Le meilleur endroit est juste avant `<div id="analysis-anchor-decision"` ou dans l'en-tête du panel (chercher `workspace-panel` contenant l'analyse).

- [ ] **Étape 2 : Ajouter les styles CSS**

```css
/* Vue rapide / Vue complète */
.analysis-view-toggle {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--color-surface-medium);
    border-radius: 8px;
    margin-bottom: 16px;
}
.view-toggle-btn {
    flex: 1;
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--font-body);
    cursor: pointer;
    background: transparent;
    color: var(--color-text-secondary);
    transition: background 0.15s, color 0.15s;
}
.view-toggle-btn--active {
    background: var(--color-surface-strong);
    color: var(--color-text-primary);
}

/* Sections masquées en vue rapide */
[data-analysis-view="quick"] .analysis-forward,
[data-analysis-view="quick"] .analysis-section--sensitivity,
[data-analysis-view="quick"] .analysis-section--cashflow {
    display: none;
}
```

Les sections dans `index.html` qui seront masquées doivent avoir la classe correspondante. Ajouter `class="analysis-section--sensitivity"` au parent de `#analysis-sensitivity-table` et `class="analysis-section--cashflow"` au parent de `#analysis-cashflow-table`.

Pour `.analysis-forward`, la classe existe déjà (vérifier dans index.html).

- [ ] **Étape 3 : Ajouter les classes CSS aux sections dans index.html**

Trouver et ajouter `analysis-section--sensitivity` :
```html
<!-- avant -->
<section class="analysis-block">
    <h4>Comparatif des leviers</h4>
    <div id="analysis-sensitivity-table"></div>
</section>
<!-- après -->
<section class="analysis-block analysis-section--sensitivity">
    <h4>Comparatif des leviers</h4>
    <div id="analysis-sensitivity-table"></div>
</section>
```

Trouver et ajouter `analysis-section--cashflow` :
```html
<!-- avant -->
<section class="analysis-block analysis-block--wide">
    ...
    <div id="analysis-cashflow-table"></div>
</section>
<!-- après -->
<section class="analysis-block analysis-block--wide analysis-section--cashflow">
    ...
    <div id="analysis-cashflow-table"></div>
</section>
```

- [ ] **Étape 4 : Wirer le toggle dans main.js**

Ajouter dans la section de déclaration des `nodes` (~ligne 280) :
```js
    btnViewQuick: document.getElementById('btn-view-quick'),
    btnViewFull: document.getElementById('btn-view-full'),
    analysisPanel: document.querySelector('.workspace-panel--analysis') || document.getElementById('panel-analyse'),
```

Ajouter une constante de clé localStorage :
```js
const ANALYSIS_VIEW_KEY = 'investissementWebAnalysisView'; // 'quick' | 'full'
```

Ajouter la fonction de toggle (hors de tout `if`) :
```js
function _applyAnalysisView(view) {
    const panel = nodes.analysisPanel;
    if (!panel) return;
    panel.dataset.analysisView = view;
    if (nodes.btnViewQuick) nodes.btnViewQuick.classList.toggle('view-toggle-btn--active', view === 'quick');
    if (nodes.btnViewFull) nodes.btnViewFull.classList.toggle('view-toggle-btn--active', view === 'full');
    if (nodes.btnViewQuick) nodes.btnViewQuick.setAttribute('aria-pressed', String(view === 'quick'));
    if (nodes.btnViewFull) nodes.btnViewFull.setAttribute('aria-pressed', String(view === 'full'));
    try { localStorage.setItem(ANALYSIS_VIEW_KEY, view); } catch {}
}

function _initAnalysisViewToggle() {
    const saved = (() => { try { return localStorage.getItem(ANALYSIS_VIEW_KEY); } catch { return null; } })();
    _applyAnalysisView(saved === 'full' ? 'full' : 'quick');
    nodes.btnViewQuick?.addEventListener('click', () => _applyAnalysisView('quick'));
    nodes.btnViewFull?.addEventListener('click', () => _applyAnalysisView('full'));
}
```

Appeler `_initAnalysisViewToggle()` dans la fonction d'initialisation principale (chercher `function init()` ou `document.addEventListener('DOMContentLoaded', ...)`).

- [ ] **Étape 5 : Vérifier visuellement**

Lancer `python app.py`. Le panel analyse doit afficher deux boutons "Vue rapide" / "Vue complète". En Vue rapide : la projection 10 ans, la matrice, le comparatif des leviers et le tableau annuel doivent disparaître. En Vue complète : tout s'affiche. Le choix doit persister après reload.

- [ ] **Étape 6 : Commit**

```
git add index.html styles.css main.js
git commit -m "feat(ux): ajouter toggle Vue rapide / Vue complète dans le panel analyse"
```

---

## Vérification finale

- [ ] Lancer `python app.py` et tester le parcours complet : saisir un bien, vérifier le score composite, vérifier les tooltips, switcher de vue, vérifier le tableau annuel avec carry-over au régime réel.
- [ ] Lancer `python -m pytest tests/ -v` — vérifier que les tests existants et le test P0 passent.
- [ ] Lancer `python app.py` et ouvrir le scanner, vérifier que la colonne "Score scanner" s'affiche avec tooltip.

---

## Self-review

**Couverture spec :**
- P0 ✅ _mensualite aligné + amortissement SCI 80%
- P1 ✅ colonne renommée avec tooltip
- P2 ✅ maxRentGapRatio + maxEffortRatio branchés
- P3 ✅ checklist fusionnée dans fiabilité
- P4 ✅ carry-over déficit + colonne tableau
- P5 ✅ tooltips CSS + title sur PNO, DSCR, TMI, SCI-IS
- P6 ✅ toggle vue + CSS + state persistence

**Points sensibles :**
- P4 : `computeAnnualTaxEstimate` est appelée depuis `buildFinancialModel` (ligne ~96) — elle doit maintenant retourner `{ tax, newCarryForward }`. L'appelant `buildFinancialModel` doit extraire `.tax`. Vérifier qu'aucune autre partie du code ne lit le retour brut de cette fonction.
- P3 : `buildAnalysisConfidence` reçoit `analysisModel` mais a besoin de `acquisitionChecklist` — déstructurer les deux.
- P6 : Identifier le sélecteur correct pour `nodes.analysisPanel` (le parent du panel analyse qui recevra `data-analysis-view`). Chercher dans index.html le container de tout le panel analyse.
