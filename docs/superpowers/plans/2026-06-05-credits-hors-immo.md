# Crédits hors immobilier — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre la saisie de crédits hors immobilier (auto, conso…) et les inclure dans le taux d'endettement total et la capacité d'emprunt restante.

**Architecture:** Nouveau tableau `autresCredits[]` dans `profileData` (localStorage). Drawer de saisie dans la section "Crédits en cours" du portfolio. `computeDebtRatios` et `computePortfolioViewModel` sont mis à jour pour accepter et utiliser ces mensualités supplémentaires.

**Tech Stack:** JavaScript vanilla, HTML, localStorage. Pas de dépendance externe. Pas de tests automatisés (projet desktop PyWebView — tester visuellement dans l'app).

---

## File Structure

| Fichier | Changement |
|---|---|
| `calculs.js:1289-1303` | `computeDebtRatios` — nouvelle signature + champs exposés |
| `calculs.js:1534-1550` | `computePortfolioViewModel` — `autresMensualites` + capacité + appel `computeDebtRatios` |
| `index.html` (après ligne 1297) | Nouveau drawer `autre-credit-drawer` |
| `main.js:610-619` | `sanitizeProfileData` — ajouter `autresCredits` |
| `main.js:306-338` | `nodes` — ajouter refs DOM du nouveau drawer |
| `main.js:2120-2128` | `buildCollectionsView` — passer `autresCredits` |
| `main.js:3887-3898` | `updateProfileFromForm` — préserver `autresCredits` |
| `main.js` (après `closeCreditDrawer`) | `openAutreCreditDrawer`, `closeAutreCreditDrawer`, `handleAutreCreditDrawerSave`, `handleDeleteAutreCredit` |
| `main.js:4032-4034` | Event listeners — câbler le nouveau drawer |
| `main.js:3623` | Appel `buildPortfolioCredits` — passer `autresCredits` |
| `main.js:3345-3383` | `buildPortfolioCredits` — ajouter section hors immo |
| `main.js:3100-3132` | `buildPortfolioDebtRatios` — afficher le détail immo/hors immo/total |
| `main.js` (après event listeners credits) | Délégation de clics pour `portfolioCredits` |
| `RESUME_PROJET.txt` | Mentionner la nouvelle fonctionnalité |

**Remarque :** Tasks 1 et 2 sont indépendantes, elles peuvent être exécutées en parallèle. Tasks 3-6 sont séquentielles (même fichier `main.js`).

---

## Task 1: Mettre à jour `calculs.js`

**Files:**
- Modify: `calculs.js:1289-1303` (fonction `computeDebtRatios`)
- Modify: `calculs.js:1534-1550` (fin de `computePortfolioViewModel`)

- [ ] **Étape 1 : Mettre à jour `computeDebtRatios`**

Remplacer la fonction entière à la ligne 1289 :

```js
// AVANT
function computeDebtRatios(mensualitesTotales, totalRentMonthly, income) {
    const revenuMensuel = Math.max(1, income / 12);

    const hcsfDenum = revenuMensuel + 0.7 * totalRentMonthly;
    const hcsfRatio = hcsfDenum > 0 ? (mensualitesTotales / hcsfDenum) * 100 : 0;
    const hcsfTone = hcsfRatio <= 28 ? 'positive' : hcsfRatio <= 35 ? 'watch' : 'negative';

    const effortNet = Math.max(0, mensualitesTotales - totalRentMonthly);
    const diffRatio = (effortNet / revenuMensuel) * 100;
    const diffTone = diffRatio <= 20 ? 'positive' : diffRatio <= 33 ? 'watch' : 'negative';

    return {
        hcsf: { ratio: hcsfRatio, seuil: 35, tone: hcsfTone },
        differentielle: { ratio: diffRatio, seuil: 33, tone: diffTone }
    };
}

// APRÈS
function computeDebtRatios(mensualitesImmo, autresMensualites, totalRentMonthly, income) {
    const mensualitesTotales = mensualitesImmo + autresMensualites;
    const revenuMensuel = Math.max(1, income / 12);

    const hcsfDenum = revenuMensuel + 0.7 * totalRentMonthly;
    const hcsfRatio = hcsfDenum > 0 ? (mensualitesTotales / hcsfDenum) * 100 : 0;
    const hcsfTone = hcsfRatio <= 28 ? 'positive' : hcsfRatio <= 35 ? 'watch' : 'negative';

    const effortNet = Math.max(0, mensualitesTotales - totalRentMonthly);
    const diffRatio = (effortNet / revenuMensuel) * 100;
    const diffTone = diffRatio <= 20 ? 'positive' : diffRatio <= 33 ? 'watch' : 'negative';

    return {
        mensualitesImmo,
        autresMensualites,
        mensualitesTotales,
        hcsf: { ratio: hcsfRatio, seuil: 35, tone: hcsfTone },
        differentielle: { ratio: diffRatio, seuil: 33, tone: diffTone }
    };
}
```

- [ ] **Étape 2 : Mettre à jour `computePortfolioViewModel`**

Dans `computePortfolioViewModel`, remplacer le bloc lignes 1534-1550 :

```js
// AVANT
    // Remaining acquisition capacity (35% debt ratio rule, amortization factor from reference loan params)
    const maxMonthlyDebt = income > 0 ? (income / 12) * 0.35 : 0;
    const remainingMonthlyCapacity = Math.max(0, maxMonthlyDebt - dashboard.totalDebtMonthly);
    const refTaux = referenceInputs['taux'] || 3.5;
    const refDuree = referenceInputs['duree'] || 20;
    const factor = amortizationFactor(refTaux, refDuree);
    const capacity = { acquisitionBudget: Math.round(remainingMonthlyCapacity * factor) };

    return {
        comparisonItems,
        portfolioItems,
        dashboard,
        decision,
        capacity,
        priorities,
        fiscal: computePortfolioFiscal(portfolioItems, tmi),
        debtRatios: computeDebtRatios(mensualitesTotales, dashboard.totalRentMonthly, income),
        projection: computeProjectionPatrimoniale(portfolioItems, householdProfile.revaloAnnuelle || 2),
        objectif: computeProgressionObjectif(dashboard, householdProfile.objectifCF || 1000)
    };
}

// APRÈS
    const autresMensualites = (householdProfile.autresCredits || []).reduce((sum, c) => sum + (c.mensualite || 0), 0);

    // Remaining acquisition capacity (35% debt ratio rule, amortization factor from reference loan params)
    const maxMonthlyDebt = income > 0 ? (income / 12) * 0.35 : 0;
    const remainingMonthlyCapacity = Math.max(0, maxMonthlyDebt - dashboard.totalDebtMonthly - autresMensualites);
    const refTaux = referenceInputs['taux'] || 3.5;
    const refDuree = referenceInputs['duree'] || 20;
    const factor = amortizationFactor(refTaux, refDuree);
    const capacity = { acquisitionBudget: Math.round(remainingMonthlyCapacity * factor) };

    return {
        comparisonItems,
        portfolioItems,
        dashboard,
        decision,
        capacity,
        priorities,
        fiscal: computePortfolioFiscal(portfolioItems, tmi),
        debtRatios: computeDebtRatios(mensualitesTotales, autresMensualites, dashboard.totalRentMonthly, income),
        projection: computeProjectionPatrimoniale(portfolioItems, householdProfile.revaloAnnuelle || 2),
        objectif: computeProgressionObjectif(dashboard, householdProfile.objectifCF || 1000)
    };
}
```

- [ ] **Étape 3 : Commit**

```bash
git add calculs.js
git commit -m "feat(calculs): computeDebtRatios inclut les mensualités hors immobilier"
```

---

## Task 2: Ajouter le drawer HTML dans `index.html`

**Files:**
- Modify: `index.html` (après la balise fermante `</aside>` du `credit-drawer`, ligne ~1297)

- [ ] **Étape 1 : Insérer le drawer après le crédit-drawer existant**

Repérer le bloc `<!-- Drawer échéancier crédit -->` (ligne ~1265). Juste après la balise fermante `</aside>` de ce drawer (ligne ~1297), insérer :

```html
    <!-- Drawer crédits hors immobilier -->
    <div id="autre-credit-drawer-overlay" class="drawer-overlay" style="display:none" aria-hidden="true"></div>
    <aside id="autre-credit-drawer" class="drawer" style="display:none" role="dialog" aria-modal="true" aria-labelledby="autre-credit-drawer-title">
        <div class="drawer-inner">
            <div class="drawer-head">
                <h3 id="autre-credit-drawer-title" class="drawer-title">Crédit hors immobilier</h3>
                <button type="button" id="autre-credit-drawer-close" class="drawer-close" aria-label="Fermer">✕</button>
            </div>
            <div class="drawer-body">
                <form id="autre-credit-drawer-form" class="credit-drawer-form" novalidate>
                    <input type="hidden" id="autre-credit-drawer-id">
                    <div class="form-field">
                        <label class="form-label" for="autre-credit-libelle">Libellé</label>
                        <input type="text" id="autre-credit-libelle" class="variables-input" maxlength="60" placeholder="ex : Crédit auto" required>
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="autre-credit-mensualite">Mensualité totale assurance incluse (€/mois)</label>
                        <input type="number" id="autre-credit-mensualite" class="variables-input" min="0" step="10" placeholder="0" required>
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="autre-credit-mensualite-ha">Mensualité hors assurance (€/mois) <span class="form-label-optional">(optionnel)</span></label>
                        <input type="number" id="autre-credit-mensualite-ha" class="variables-input" min="0" step="10" placeholder="0">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="autre-credit-date-debut">Date de début <span class="form-label-optional">(optionnel)</span></label>
                        <input type="month" id="autre-credit-date-debut" class="variables-input">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="autre-credit-date-fin">Date de fin <span class="form-label-optional">(optionnel)</span></label>
                        <input type="month" id="autre-credit-date-fin" class="variables-input">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="autre-credit-crd">Capital restant dû (€) <span class="form-label-optional">(optionnel)</span></label>
                        <input type="number" id="autre-credit-crd" class="variables-input" min="0" step="100" placeholder="0">
                    </div>
                    <div class="drawer-actions">
                        <button type="button" id="autre-credit-drawer-cancel" class="btn-secondary">Annuler</button>
                        <button type="submit" id="autre-credit-drawer-save" class="btn-primary">Enregistrer</button>
                    </div>
                </form>
            </div>
        </div>
    </aside>
```

- [ ] **Étape 2 : Commit**

```bash
git add index.html
git commit -m "feat(html): ajouter drawer crédits hors immobilier"
```

---

## Task 3: Mettre à jour la couche données dans `main.js`

**Files:**
- Modify: `main.js:610-619` (`sanitizeProfileData`)
- Modify: `main.js:306-338` (objet `nodes`)
- Modify: `main.js:2120-2128` (`buildCollectionsView`)
- Modify: `main.js:3887-3898` (`updateProfileFromForm`)

- [ ] **Étape 1 : `sanitizeProfileData` — ajouter `autresCredits`**

```js
// AVANT (ligne 610)
function sanitizeProfileData(rawProfile) {
    return {
        name: normalizeLegacyCopy(rawProfile.name || 'Profil') || 'Profil',
        income: Math.max(0, Number(rawProfile.income) || 0),
        adults: Math.min(2, Math.max(1, Number(rawProfile.adults) || 1)),
        children: Math.max(0, Math.round(Number(rawProfile.children) || 0)),
        objectifCF: Math.max(0, Number(rawProfile.objectifCF) || 1000),
        revaloAnnuelle: Math.max(0, Math.min(20, Number(rawProfile.revaloAnnuelle) || 2))
    };
}

// APRÈS
function sanitizeProfileData(rawProfile) {
    return {
        name: normalizeLegacyCopy(rawProfile.name || 'Profil') || 'Profil',
        income: Math.max(0, Number(rawProfile.income) || 0),
        adults: Math.min(2, Math.max(1, Number(rawProfile.adults) || 1)),
        children: Math.max(0, Math.round(Number(rawProfile.children) || 0)),
        objectifCF: Math.max(0, Number(rawProfile.objectifCF) || 1000),
        revaloAnnuelle: Math.max(0, Math.min(20, Number(rawProfile.revaloAnnuelle) || 2)),
        autresCredits: Array.isArray(rawProfile.autresCredits) ? rawProfile.autresCredits : []
    };
}
```

- [ ] **Étape 2 : `nodes` — ajouter les refs DOM du nouveau drawer**

Dans l'objet `nodes` (bloc démarrant vers ligne 306), après la ligne `portfolioCredits: document.getElementById('portfolio-credits'),`, ajouter :

```js
        autreCreditDrawerOverlay: document.getElementById('autre-credit-drawer-overlay'),
        autreCreditDrawer: document.getElementById('autre-credit-drawer'),
        autreCreditDrawerId: document.getElementById('autre-credit-drawer-id'),
        autreCreditLibelle: document.getElementById('autre-credit-libelle'),
        autreCreditMensualite: document.getElementById('autre-credit-mensualite'),
        autreCreditMensualiteHa: document.getElementById('autre-credit-mensualite-ha'),
        autreCreditDateDebut: document.getElementById('autre-credit-date-debut'),
        autreCreditDateFin: document.getElementById('autre-credit-date-fin'),
        autreCreditCrd: document.getElementById('autre-credit-crd'),
```

- [ ] **Étape 3 : `buildCollectionsView` — transmettre `autresCredits`**

```js
// AVANT (ligne 2120)
function buildCollectionsView() {
    return computePortfolioViewModel(state.assetRecords, {
        income: state.profileData.income,
        adults: state.profileData.adults,
        children: state.profileData.children,
        objectifCF: state.profileData.objectifCF,
        revaloAnnuelle: state.profileData.revaloAnnuelle
    }, state.activeAssetId, state.variablesData);
}

// APRÈS
function buildCollectionsView() {
    return computePortfolioViewModel(state.assetRecords, {
        income: state.profileData.income,
        adults: state.profileData.adults,
        children: state.profileData.children,
        objectifCF: state.profileData.objectifCF,
        revaloAnnuelle: state.profileData.revaloAnnuelle,
        autresCredits: state.profileData.autresCredits
    }, state.activeAssetId, state.variablesData);
}
```

- [ ] **Étape 4 : `updateProfileFromForm` — préserver `autresCredits`**

```js
// AVANT (ligne 3887)
function updateProfileFromForm() {
    state.profileData = sanitizeProfileData({
        name: nodes.profileName.value,
        income: nodes.profileIncome.value,
        adults: nodes.profileAdults.value,
        children: nodes.profileChildren.value,
        objectifCF: nodes.profileObjectifCF?.value,
        revaloAnnuelle: nodes.profileRevaloAnnuelle?.value
    });
    saveProfileData();
    emitStateUpdate();
    render({ syncProfile: false, syncVariables: false });
}

// APRÈS
function updateProfileFromForm() {
    state.profileData = sanitizeProfileData({
        name: nodes.profileName.value,
        income: nodes.profileIncome.value,
        adults: nodes.profileAdults.value,
        children: nodes.profileChildren.value,
        objectifCF: nodes.profileObjectifCF?.value,
        revaloAnnuelle: nodes.profileRevaloAnnuelle?.value,
        autresCredits: state.profileData.autresCredits
    });
    saveProfileData();
    emitStateUpdate();
    render({ syncProfile: false, syncVariables: false });
}
```

- [ ] **Étape 5 : Commit**

```bash
git add main.js
git commit -m "feat(main): couche données autresCredits dans profileData"
```

---

## Task 4: Ajouter le CRUD drawer dans `main.js`

**Files:**
- Modify: `main.js` (ajouter 4 fonctions après `closeCreditDrawer`, vers ligne 1614)
- Modify: `main.js` (ajouter 3 event listeners dans le bloc init, vers ligne 4032)

- [ ] **Étape 1 : Ajouter les 4 fonctions CRUD**

Insérer ces fonctions après la fonction `closeCreditDrawer` (ligne ~1614) :

```js
function openAutreCreditDrawer(creditId) {
    const credit = creditId
        ? (state.profileData.autresCredits || []).find(c => c.id === creditId)
        : null;
    nodes.autreCreditDrawerId.value = creditId || '';
    nodes.autreCreditLibelle.value = credit?.libelle || '';
    nodes.autreCreditMensualite.value = credit?.mensualite != null ? String(credit.mensualite) : '';
    nodes.autreCreditMensualiteHa.value = credit?.mensualiteHorsAssurance != null ? String(credit.mensualiteHorsAssurance) : '';
    nodes.autreCreditDateDebut.value = credit?.dateDebut || '';
    nodes.autreCreditDateFin.value = credit?.dateFin || '';
    nodes.autreCreditCrd.value = credit?.capitalRestantDu != null ? String(credit.capitalRestantDu) : '';
    nodes.autreCreditDrawerOverlay.style.display = 'block';
    nodes.autreCreditDrawer.style.display = 'block';
    nodes.autreCreditDrawerOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    void nodes.autreCreditDrawer.offsetWidth;
    nodes.autreCreditDrawerOverlay.classList.add('is-open');
    nodes.autreCreditDrawer.classList.add('is-open');
    nodes.autreCreditDrawerOverlay.onclick = closeAutreCreditDrawer;
    window.requestAnimationFrame(() => nodes.autreCreditLibelle?.focus());
}

function closeAutreCreditDrawer() {
    nodes.autreCreditDrawerOverlay?.classList.remove('is-open');
    nodes.autreCreditDrawer?.classList.remove('is-open');
    nodes.autreCreditDrawerOverlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    setTimeout(() => {
        if (nodes.autreCreditDrawerOverlay) nodes.autreCreditDrawerOverlay.style.display = 'none';
        if (nodes.autreCreditDrawer) nodes.autreCreditDrawer.style.display = 'none';
    }, 220);
}

function handleAutreCreditDrawerSave(event) {
    event.preventDefault();
    const creditId = nodes.autreCreditDrawerId.value;
    const libelle = nodes.autreCreditLibelle.value.trim();
    if (!libelle) { nodes.autreCreditLibelle.focus(); return; }
    const mensualite = Math.max(0, Number(nodes.autreCreditMensualite.value) || 0);
    if (!mensualite) { nodes.autreCreditMensualite.focus(); return; }
    const haRaw = nodes.autreCreditMensualiteHa.value;
    const mensualiteHorsAssurance = haRaw !== '' ? Math.max(0, Number(haRaw) || 0) : null;
    const dateDebut = nodes.autreCreditDateDebut.value || null;
    const dateFin = nodes.autreCreditDateFin.value || null;
    const crdRaw = nodes.autreCreditCrd.value;
    const capitalRestantDu = crdRaw !== '' ? Math.max(0, Number(crdRaw) || 0) : null;

    const entry = {
        id: creditId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        libelle,
        mensualite,
        mensualiteHorsAssurance,
        dateDebut,
        dateFin,
        capitalRestantDu
    };
    const credits = [...(state.profileData.autresCredits || [])];
    const idx = credits.findIndex(c => c.id === entry.id);
    if (idx >= 0) credits.splice(idx, 1, entry);
    else credits.push(entry);

    state.profileData = { ...state.profileData, autresCredits: credits };
    saveProfileData();
    closeAutreCreditDrawer();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
    showToast('Crédit enregistré.');
}

function handleDeleteAutreCredit(creditId) {
    state.profileData = {
        ...state.profileData,
        autresCredits: (state.profileData.autresCredits || []).filter(c => c.id !== creditId)
    };
    saveProfileData();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
    showToast('Crédit supprimé.');
}
```

- [ ] **Étape 2 : Câbler les event listeners**

Dans le bloc init (après `document.getElementById('credit-drawer-form')?.addEventListener('submit', handleCreditDrawerSave);`, ligne ~4034), ajouter :

```js
    document.getElementById('autre-credit-drawer-close')?.addEventListener('click', closeAutreCreditDrawer);
    document.getElementById('autre-credit-drawer-cancel')?.addEventListener('click', closeAutreCreditDrawer);
    document.getElementById('autre-credit-drawer-form')?.addEventListener('submit', handleAutreCreditDrawerSave);
    if (nodes.portfolioCredits) nodes.portfolioCredits.addEventListener('click', handlePortfolioCreditsAction);
```

- [ ] **Étape 3 : Ajouter la fonction de délégation de clics**

Ajouter après `handleDeleteAutreCredit` :

```js
function handlePortfolioCreditsAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const creditId = button.dataset.creditId;
    if (action === 'add-autre-credit') { openAutreCreditDrawer(null); return; }
    if (action === 'edit-autre-credit' && creditId) { openAutreCreditDrawer(creditId); return; }
    if (action === 'delete-autre-credit' && creditId) { handleDeleteAutreCredit(creditId); return; }
}
```

- [ ] **Étape 4 : Commit**

```bash
git add main.js
git commit -m "feat(main): CRUD crédits hors immobilier avec drawer"
```

---

## Task 5: Mettre à jour le rendu dans `main.js`

**Files:**
- Modify: `main.js:3623` (appel `buildPortfolioCredits`)
- Modify: `main.js:3345-3383` (fonction `buildPortfolioCredits`)
- Modify: `main.js:3100-3132` (fonction `buildPortfolioDebtRatios`)

- [ ] **Étape 1 : Mettre à jour l'appel à `buildPortfolioCredits` dans `renderCollections`**

```js
// AVANT (ligne 3623)
    buildPortfolioCredits(collectionsView.portfolioItems);

// APRÈS
    buildPortfolioCredits(collectionsView.portfolioItems, state.profileData.autresCredits);
```

- [ ] **Étape 2 : Réécrire `buildPortfolioCredits`**

Remplacer la fonction entière (lignes 3345-3383) :

```js
function buildPortfolioCredits(portfolioItems, autresCredits) {
    if (!nodes.portfolioCredits) return;
    const itemsWithCredit = portfolioItems.filter(item => item.creditSchedule || item.model.mensualiteTotale > 0);
    const credits = autresCredits || [];

    if (!itemsWithCredit.length && !credits.length) {
        nodes.portfolioCredits.innerHTML = '<p class="collection-empty">Aucun crédit configuré.</p>';
        return;
    }

    let immoHtml = '';
    if (itemsWithCredit.length) {
        immoHtml = `
        <h5 class="analysis-subsection-title">Crédits immobiliers</h5>
        <table class="analysis-table">
            <thead><tr><th>Bien</th><th>Mensualité</th><th>Capital restant dû</th><th>Date de fin</th><th>Source</th></tr></thead>
            <tbody>
                ${itemsWithCredit.map(item => {
                    const cs = item.creditSchedule;
                    const mensualite = cs ? cs.mensualite : (item.model.mensualiteTotale || 0);
                    const cap = cs ? capitalRestantDu(cs.mensualite, cs.dateFin) : null;
                    const dateFin = cs?.dateFin ? cs.dateFin.replace('-', '/') : '--';
                    const source = cs ? 'Échéancier réel' : 'Simulé';
                    return `
                        <tr>
                            <td><strong>${escapeHtml(item.name)}</strong><div class="table-subline">${escapeHtml(item.city)}</div></td>
                            <td><strong>${formatPlainCurrency(mensualite)}</strong></td>
                            <td>${cap != null ? `<strong>${formatPlainCurrency(cap)}</strong>` : '--'}</td>
                            <td>${escapeHtml(dateFin)}</td>
                            <td><span class="status-pill status-pill--${cs ? 'positive' : 'neutral'}">${escapeHtml(source)}</span></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>`;
    }

    const totalMensualiteHI = credits.reduce((s, c) => s + (c.mensualite || 0), 0);
    const totalCrdHI = credits.some(c => c.capitalRestantDu != null)
        ? credits.reduce((s, c) => s + (c.capitalRestantDu || 0), 0)
        : null;

    const horsImmoHtml = `
        <h5 class="analysis-subsection-title" style="margin-top:1.5rem">Crédits hors immobilier</h5>
        ${credits.length ? `
        <table class="analysis-table">
            <thead><tr><th>Libellé</th><th>Mensualité</th><th>Capital restant dû</th><th>Date de fin</th><th></th></tr></thead>
            <tbody>
                ${credits.map(c => {
                    const dateFin = c.dateFin ? c.dateFin.replace('-', '/') : '--';
                    return `
                        <tr>
                            <td><strong>${escapeHtml(c.libelle)}</strong></td>
                            <td><strong>${formatPlainCurrency(c.mensualite)}</strong></td>
                            <td>${c.capitalRestantDu != null ? `<strong>${formatPlainCurrency(c.capitalRestantDu)}</strong>` : '--'}</td>
                            <td>${escapeHtml(dateFin)}</td>
                            <td style="white-space:nowrap">
                                <button class="btn-icon" data-action="edit-autre-credit" data-credit-id="${escapeHtml(c.id)}" title="Modifier">✎</button>
                                <button class="btn-icon btn-icon--danger" data-action="delete-autre-credit" data-credit-id="${escapeHtml(c.id)}" title="Supprimer">✕</button>
                            </td>
                        </tr>
                    `;
                }).join('')}
                <tr class="analysis-table__total">
                    <td><strong>Total</strong></td>
                    <td><strong>${formatPlainCurrency(totalMensualiteHI)}</strong></td>
                    <td>${totalCrdHI != null ? `<strong>${formatPlainCurrency(totalCrdHI)}</strong>` : '--'}</td>
                    <td colspan="2"></td>
                </tr>
            </tbody>
        </table>` : '<p class="collection-empty">Aucun crédit hors immobilier.</p>'}
        <div style="margin-top:0.75rem">
            <button class="btn-secondary" data-action="add-autre-credit">+ Ajouter un crédit</button>
        </div>`;

    nodes.portfolioCredits.innerHTML = immoHtml + horsImmoHtml;
}
```

- [ ] **Étape 3 : Mettre à jour `buildPortfolioDebtRatios`**

Remplacer la fonction entière (lignes 3100-3132) :

```js
function buildPortfolioDebtRatios(debtRatios) {
    if (!nodes.portfolioDebtRatios) return;
    if (!debtRatios) {
        nodes.portfolioDebtRatios.innerHTML = '<p class="collection-empty">Aucun bien détenu pour calculer le taux d\'endettement.</p>';
        return;
    }
    function gauge(ratio, seuil, tone, label, method) {
        const pct = Math.min(100, (ratio / seuil) * 100);
        return `
            <div class="debt-gauge">
                <div class="debt-gauge-head">
                    <span class="debt-gauge-method">${escapeHtml(method)}</span>
                    <strong class="status-pill status-pill--${tone}">${ratio.toFixed(1).replace('.', ',')} %</strong>
                </div>
                <div class="debt-gauge-bar">
                    <div class="debt-gauge-fill debt-gauge-fill--${tone}" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <div class="debt-gauge-footer">
                    <span>${escapeHtml(label)}</span>
                    <span>Seuil : ${seuil} %</span>
                </div>
            </div>
        `;
    }
    const breakdownHtml = debtRatios.autresMensualites > 0 ? `
        <div class="analysis-list-compact" style="margin-bottom:1rem">
            <div class="status-item">
                <span class="status-label">Mensualités immo</span>
                <strong>${formatPlainCurrency(debtRatios.mensualitesImmo)}/mois</strong>
            </div>
            <div class="status-item">
                <span class="status-label">Crédits hors immo</span>
                <strong>${formatPlainCurrency(debtRatios.autresMensualites)}/mois</strong>
            </div>
            <div class="status-item">
                <span class="status-label">Total mensualités</span>
                <strong>${formatPlainCurrency(debtRatios.mensualitesTotales)}/mois</strong>
            </div>
        </div>` : '';
    nodes.portfolioDebtRatios.innerHTML = `
        <div class="debt-ratios-shell">
            ${breakdownHtml}
            ${gauge(debtRatios.hcsf.ratio, debtRatios.hcsf.seuil, debtRatios.hcsf.tone,
                'Mensualités totales / (Revenus nets + 70 % loyers bruts)', 'Méthode HCSF 2021')}
            ${gauge(debtRatios.differentielle.ratio, debtRatios.differentielle.seuil, debtRatios.differentielle.tone,
                'Effort net total / Revenus nets', 'Méthode différentielle')}
        </div>
    `;
}
```

- [ ] **Étape 4 : Commit**

```bash
git add main.js
git commit -m "feat(main): rendu crédits hors immo + détail taux d'endettement"
```

---

## Task 6: Mettre à jour `RESUME_PROJET.txt` et `Lancer.bat`

**Files:**
- Modify: `RESUME_PROJET.txt`
- Review: `Lancer.bat`

- [ ] **Étape 1 : Mettre à jour `RESUME_PROJET.txt`**

Dans la section "MODULE PORTEFEUILLE" (ou section équivalente listant les fonctionnalités), ajouter après la ligne mentionnant le taux d'endettement :

```
  • Crédits hors immobilier (auto, conso, personnel…) : saisie détaillée
    par crédit (libellé, mensualité, date de fin, capital restant dû optionnel)
    — inclus dans le taux d'endettement total (méthode HCSF et différentielle)
    et déduits de la capacité d'emprunt restante
```

- [ ] **Étape 2 : Vérifier `Lancer.bat`**

`Lancer.bat` tue le port 8080 et relance `pythonw app.py`. Aucune modification n'est requise pour cette fonctionnalité (changement purement frontend). Vérifier visuellement que le launcher démarre l'app sans erreur après les changements.

- [ ] **Étape 3 : Commit**

```bash
git add RESUME_PROJET.txt
git commit -m "docs: mentionner crédits hors immobilier dans le résumé projet"
```

---

## Vérification finale

Après les 6 tâches, tester dans l'app (via `Lancer.bat` ou `python app.py`) :

1. Aller dans le portfolio avec au moins 1 bien détenu
2. Dans la section "Crédits en cours", voir apparaître "Crédits hors immobilier" avec le bouton "+ Ajouter un crédit"
3. Cliquer "+ Ajouter un crédit" → le drawer s'ouvre
4. Saisir libellé "Crédit auto", mensualité 350, date de fin 2028-06, CRD 8000 → Enregistrer
5. Vérifier que la ligne apparaît dans le tableau
6. Vérifier que le taux d'endettement bancaire reflète les mensualités hors immo (breakdownhtml visible si autresMensualites > 0)
7. Modifier le crédit → les données se pré-remplissent dans le drawer
8. Supprimer le crédit → la ligne disparaît
9. Rouvrir et fermer l'app → les crédits sont persistés (localStorage)
