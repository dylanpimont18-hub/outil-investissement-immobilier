# Corrections portefeuille P0→P2 — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger 7 bugs/problèmes identifiés lors de l'audit du 2026-06-11 dans la partie portefeuille biens détenus.

**Architecture:** Toutes les corrections touchent `main.js` (logique UI + données) et `calculs.js` (moteur financier). Aucune nouvelle dépendance, aucun nouveau fichier. Les tâches sont indépendantes et peuvent être appliquées dans n'importe quel ordre.

**Tech Stack:** Vanilla JS ES modules, localStorage, PyWebView/Flask desktop app.

---

## Fichiers modifiés

| Fichier | Tâches concernées |
|---|---|
| `main.js` | T1, T2, T4, T5, T6, T7 |
| `calculs.js` | T3 |

---

### Task 1 : Corriger accumulation de listeners dans les accordéons

**Problème :** `renderAccordionAcquisition` et `renderAccordionPostAchat` ajoutent un `addEventListener('change', ...)` sur le container persistant à chaque re-render. Après N renders, N handlers s'exécutent par event.

**Fichier :** `main.js` — fonctions `renderAccordionAcquisition` (~ligne 4648) et `renderAccordionPostAchat` (~ligne 4759)

- [ ] **Étape 1 : Wrapper le listener d'acquisition dans un garde**

Dans `renderAccordionAcquisition`, remplacer :
```js
nodes.accAcquisitionContent.addEventListener('change', e => {
```
par :
```js
if (!nodes.accAcquisitionContent.dataset.acqWired) {
    nodes.accAcquisitionContent.dataset.acqWired = '1';
    nodes.accAcquisitionContent.addEventListener('change', e => {
```
et fermer avec `});` supplémentaire à la fin du bloc handler (avant la dernière `}`de la fonction).

- [ ] **Étape 2 : Wrapper le listener post-achat dans un garde**

Dans `renderAccordionPostAchat`, les listeners sur `[data-post-field]` sont déjà sur des éléments remplacés (querySelectorAll) → OK. Mais vérifier s'il existe un `addEventListener` sur le container lui-même — si oui, appliquer le même garde `dataset.postWired`.

- [ ] **Étape 3 : Vérification manuelle**

Lancer `python app.py`. Ajouter un bien, ouvrir la fiche. Dans Acquisition, modifier "Prix d'achat" puis "Durée" — vérifier dans la console qu'un seul `updateOwnedAcquisition` est appelé par changement (pas N appels).

---

### Task 2 : Corriger loyer:0 dans les scénarios par défaut

**Problème :** Les scénarios initialisent `loyer: 0` explicitement, ce qui bloque l'opérateur `??` dans `computeOwnedAssetCF`. `0 ?? x === 0`, donc le fallback `acq.loyerInitial` n'est jamais utilisé.

**Fichier :** `main.js` — `createOwnedAsset` (~ligne 79) et `addOwnedScenario` (~ligne 168)

- [ ] **Étape 1 : Retirer loyer et taxeFonciere des scénarios par défaut**

Dans `createOwnedAsset`, remplacer :
```js
scenarios: [
    { id: 'pessimiste', nom: 'Pessimiste', variables: { loyer: 0, taxeFonciere: 0, vacance: 8, regime: 'micro-foncier' } },
    { id: 'realiste',   nom: 'Réaliste',   variables: { loyer: 0, taxeFonciere: 0, vacance: 5, regime: 'micro-foncier' } },
    { id: 'optimiste',  nom: 'Optimiste',  variables: { loyer: 0, taxeFonciere: 0, vacance: 2, regime: 'micro-foncier' } }
],
```
par :
```js
scenarios: [
    { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
    { id: 'realiste',   nom: 'Réaliste',   variables: { vacance: 5, regime: 'micro-foncier' } },
    { id: 'optimiste',  nom: 'Optimiste',  variables: { vacance: 2, regime: 'micro-foncier' } }
],
```

- [ ] **Étape 2 : Même fix dans addOwnedScenario**

Remplacer :
```js
all[assetId].scenarios.push({
    id, nom: 'Nouveau', variables: { loyer: 0, taxeFonciere: 0, vacance: 5, regime: 'micro-foncier' }
});
```
par :
```js
all[assetId].scenarios.push({
    id, nom: 'Nouveau', variables: { vacance: 5, regime: 'micro-foncier' }
});
```

- [ ] **Étape 3 : Vérification manuelle**

Créer un bien avec loyerInitial = 800 €. Sans toucher aux scénarios → le simulateur doit afficher un CF calculé sur 800 €/mois (pas 0).

---

### Task 3 : Corriger la base fiscale dans computeOwnedAssetCF

**Problème :** `buildFinancialModel` reçoit `montantCredit` comme `prixNet`. Pour SCI-IS, l'amortissement annuel est `prixNet * 0.80 / 30` — avec un crédit de 150k sur un bien à 200k, l'amortissement est sous-estimé de 25%.

**Fichier :** `calculs.js` — `computeOwnedAssetCF` (~ligne 1814)

- [ ] **Étape 1 : Modifier computeOwnedAssetCF**

Remplacer :
```js
const inputs = {
    'taux-input': credit.taux || 0,
    'duree': credit.duree || 0,
    'assurance': credit.assurance || 0,
    'apport': 0,
    'notaire': 0,
    ...
};

const loyer = scenario.loyer ?? acq.loyerInitial ?? 0;
const montantCredit = credit.montant || 0;
const model = buildFinancialModel(montantCredit, loyer, inputs, tmi);
```
par :
```js
const prixAcquisition = acq.prix || 0;
const montantCredit = credit.montant || 0;
const inputs = {
    'taux-input': credit.taux || 0,
    'duree': credit.duree || 0,
    'assurance': credit.assurance || 0,
    'apport': Math.max(0, prixAcquisition - montantCredit),
    'notaire': 0,
    'agence': 0,
    'travaux': 0,
    'meubles': 0,
    'frais-bancaires': 0,
    'vacance': scenario.vacance ?? 5,
    'copro': scenario.chargesCopro ?? post.chargesCopro ?? 0,
    'fonciere': scenario.taxeFonciere ?? post.taxeFonciere ?? 0,
    'pno': post.assurancePNO ?? 0,
    'gestion': post.gestionLocative ?? 0,
    'regime': scenario.regime || 'micro-foncier',
};

const loyer = scenario.loyer ?? acq.loyerInitial ?? 0;
const model = buildFinancialModel(prixAcquisition, loyer, inputs, tmi);
```

**Mécanisme :** `montantFinance = max(0, prixAcquisition + 0 + 0 - apport) = max(0, prixAcquisition - (prixAcquisition - montantCredit)) = montantCredit`. La mensualité est calculée sur le bon montant, et la base fiscale SCI-IS utilise le prix réel.

- [ ] **Étape 2 : Vérification manuelle**

Créer un bien : prix = 200 000 €, crédit = 150 000 €, régime SCI-IS. L'impôt annuel estimé doit être calculé avec un amortissement de `200 000 * 0.80 / 30 = 5 333 €/an` (au lieu de `150 000 * 0.80 / 30 = 4 000 €/an`).

---

### Task 4 : Corriger la moyenne de rendement non pondérée

**Problème :** `avgRdt = sum(rentaBrute) / n` — moyenne arithmétique non pondérée. Trompeuse quand les biens ont des tailles différentes.

**Fichier :** `main.js` — `renderOwnedPortfolioList` (~ligne 4427)

- [ ] **Étape 1 : Remplacer par une moyenne pondérée par investissement total**

Remplacer :
```js
const avgRdt = results.reduce((s, r) => s + r.rentaBrute, 0) / results.length;
```
par :
```js
const totalInvest = list.reduce((s, a) =>
    s + (a.acquisition?.prix || 0) + (a.acquisition?.fraisAgence || 0) + (a.acquisition?.fraisNotaire || 0), 0);
const avgRdt = totalInvest > 0
    ? results.reduce((s, r, i) => {
        const invest = (list[i].acquisition?.prix || 0) + (list[i].acquisition?.fraisAgence || 0) + (list[i].acquisition?.fraisNotaire || 0);
        return s + r.rentaBrute * invest;
    }, 0) / totalInvest
    : 0;
```

- [ ] **Étape 2 : Vérification manuelle**

Avec deux biens (50 000 € à 15% et 500 000 € à 5%) → le KPI banner doit afficher ~5,8% et non 10%.

---

### Task 5 : Supprimer le code mort

**Problème :** ~870 lignes de fonctions jamais appelées, héritées de l'ancien système portfolio.

**Fichier :** `main.js`

- [ ] **Étape 1 : Supprimer le bloc assetMeta (lignes ~200–248)**

Supprimer les lignes contenant :
- `const ASSET_META_KEY = ...`
- `function loadAssetMeta() { ... }`
- `function saveAssetMeta(meta) { ... }`
- `function getAssetMeta(assetId) { ... }`
- `function setAssetMeta(assetId, patch) { ... }`
- `function addTravail(assetId, travail) { ... }`
- `function deleteTravail(assetId, travailId) { ... }`
- `function addNote(assetId, text) { ... }`

- [ ] **Étape 2 : Supprimer le bloc de fonctions mortes (lignes ~2121–2953)**

Supprimer depuis le commentaire JSDoc avant `computePortfolioAdvice` jusqu'à la fin de `buildPortfolioAssetGrid` (inclus). Fonctions visées :
- `computePortfolioAdvice`
- `buildPortfolioKpiBanner`
- `buildPortfolioDashboardZone`
- `buildPortfolioAdviceZone`
- `buildPortfolioFiches`
- `buildFicheTravaux`
- `buildFicheNotes`
- `buildPortfolioPipelineZone`
- `buildPortfolioAssetCard`
- `buildPortfolioAssetGrid`

- [ ] **Étape 3 : Nettoyer les entrées nulles dans `nodes` (~lignes 535–547)**

Supprimer dans le bloc `nodes = { ... }` les lignes :
```js
portfolioKpiBanner: document.getElementById('portfolio-kpi-banner'),
portfolioAssetGridOwned: document.getElementById('portfolio-asset-grid-owned'),
portfolioAssetGridPipeline: document.getElementById('portfolio-asset-grid-pipeline'),
portfolioAlerts: document.getElementById('portfolio-alerts'),
portfolioAdvice: document.getElementById('portfolio-advice'),
portfolioAdviceCards: document.getElementById('portfolio-advice-cards'),
portfolioOwnedZone: document.getElementById('portfolio-owned-zone'),
portfolioFiches: document.getElementById('portfolio-fiches'),
portfolioPipelineZone: document.getElementById('portfolio-pipeline-zone'),
portfolioDonutConsolidatedWrap: document.getElementById('portfolio-donut-consolidated-wrap'),
```

- [ ] **Étape 4 : Vérifier que l'app se charge sans erreur**

Lancer `python app.py`. Ouvrir le panel Portefeuille, vérifier que la liste et le détail fonctionnent normalement. Vérifier la console JS : aucune ReferenceError.

---

### Task 6 : Améliorer la colonne Statut

**Problème :** La colonne Statut ne montre que les travaux à classifier. Un bien avec CF négatif ou DSCR < 1 affiche "RAS".

**Fichier :** `main.js` — `renderOwnedPortfolioList` (~ligne 4476)

- [ ] **Étape 1 : Remplacer la logique de statut**

Remplacer :
```js
const hasUnclassified = (asset.postAchat?.travaux || []).some(t => t.tag === 'a-classifier');
return `
<tr data-asset-id="${escapeHtml(asset.id)}">
    ...
    <td>
        <span class="owned-status-badge owned-status-badge--${hasUnclassified ? 'watch' : 'ras'}">
            ${hasUnclassified ? '⚠ Travaux' : 'RAS'}
        </span>
    </td>
```
par :
```js
const hasUnclassified = (asset.postAchat?.travaux || []).some(t => t.tag === 'a-classifier');
let statusTone, statusLabel;
if (r.cfNetNet < -50) {
    statusTone = 'negative'; statusLabel = `CF ${Math.round(r.cfNetNet).toLocaleString('fr-FR')} €`;
} else if (r.dscr > 0 && r.dscr < 1) {
    statusTone = 'negative'; statusLabel = `DSCR ${r.dscr.toFixed(2).replace('.', ',')}`;
} else if (r.dscr >= 1 && r.dscr < 1.1) {
    statusTone = 'watch'; statusLabel = 'DSCR tendu';
} else if (hasUnclassified) {
    statusTone = 'watch'; statusLabel = '⚠ Travaux';
} else {
    statusTone = 'ras'; statusLabel = 'RAS';
}
return `
<tr data-asset-id="${escapeHtml(asset.id)}">
    ...
    <td>
        <span class="owned-status-badge owned-status-badge--${statusTone}">
            ${statusLabel}
        </span>
    </td>
```

- [ ] **Étape 2 : Ajouter le style CSS pour `--negative`**

Vérifier dans `styles.css` que `.owned-status-badge--negative` est défini. Si non, ajouter proche de `.owned-status-badge--watch` :
```css
.owned-status-badge--negative {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
}
```

- [ ] **Étape 3 : Vérification manuelle**

Créer un bien avec CF négatif → badge rouge avec valeur CF. Créer un bien avec DSCR 0,95 → badge rouge "DSCR 0,95". Créer un bien avec DSCR 1,05 → badge orange "DSCR tendu".

---

### Task 7 : Ajouter l'export JSON

**Problème :** Les données `ownedAssets` sont uniquement en localStorage, sans export. Un reset navigateur détruit tout.

**Fichier :** `main.js` — `renderOwnedPortfolioList` et `initOwnedPortfolioEvents`

- [ ] **Étape 1 : Ajouter le bouton dans l'en-tête de liste**

Dans `renderOwnedPortfolioList`, après `nodes.ownedKpiBanner.innerHTML = ...`, ajouter le bouton Export dans le HTML de `owned-list-header` via `index.html` — ou l'injecter dans le KPI banner. Option la plus simple : ajouter le bouton dans `index.html` dans `.owned-list-header` :

Dans `index.html`, remplacer dans `#owned-list-view .owned-list-header` :
```html
<button id="owned-add-btn" class="btn btn--primary" type="button">+ Ajouter un bien</button>
```
par :
```html
<div style="display:flex;gap:8px">
    <button id="owned-export-btn" class="btn btn--ghost btn--sm" type="button" title="Exporter le portefeuille en JSON">↓ Export</button>
    <button id="owned-add-btn" class="btn btn--primary" type="button">+ Ajouter un bien</button>
</div>
```

- [ ] **Étape 2 : Câbler l'événement dans initOwnedPortfolioEvents**

Dans `initOwnedPortfolioEvents`, ajouter après le câblage de `ownedAddBtn` :
```js
const exportBtn = document.getElementById('owned-export-btn');
if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        const data = loadOwnedAssets();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `portefeuille-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
}
```

- [ ] **Étape 3 : Vérification manuelle**

Avec des biens dans la liste, cliquer "↓ Export" → un fichier `portefeuille-YYYY-MM-DD.json` doit être téléchargé, contenant l'objet complet de tous les biens.

---

## Notes sur les biens existants (rétrocompatibilité)

Les biens déjà créés avec `loyer: 0` dans leurs scénarios (task 2) conserveront `0` en localStorage. La fix ne s'applique qu'aux nouveaux biens et nouveaux scénarios. Pour les biens existants, l'utilisateur peut effacer le `0` dans le simulateur — une fois vide, la cellule redevient vide et le fallback `??` s'applique.
