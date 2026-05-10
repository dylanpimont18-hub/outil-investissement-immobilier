# Ergonomie — Progressive Disclosure + Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un séparateur visuel Essentiel/Avancé dans le formulaire et un tooltip d'aide au survol sur chacun des 36 champs.

**Architecture:** Deux changements indépendants : (1) CSS pur pour les styles du séparateur, badge et tooltip ; (2) HTML pour la structure (réordonnancement d'une section, insertion du séparateur, des badges et des boutons `?`). Aucun JS requis — le tooltip fonctionne entièrement par `:hover` + `::after` CSS. Aucun fichier JS modifié.

**Tech Stack:** HTML5, CSS3 (custom properties, `::after`, `:has()`), vanilla — aucun framework, aucun bundler.

---

## Structure des fichiers

| Fichier | Modifications |
|---|---|
| `styles.css` | Ajout de 6 blocs CSS : layout accordion, `.accord-badge`, `.form-advanced-sep`, overflow fix, `.field-hint`, tooltip `::after`/`::before` |
| `index.html` | Déplacement de la section Fiscalité, ajout du séparateur, 4 badges, 36 boutons `field-hint` |

---

## Task 1 : CSS — Layout accordéon + styles progressive disclosure

**Files:**
- Modify: `styles.css` (autour de la ligne 303, section accordéon)

- [ ] **Step 1 : Modifier `.accord-head` pour supprimer `justify-content: space-between`**

Remplacer le bloc existant (actuellement autour de la ligne 276) :

```css
.accord-head {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--surface-strong);
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    transition: background 150ms;
}
```

Par :

```css
.accord-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--surface-strong);
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    transition: background 150ms;
}
```

- [ ] **Step 2 : Ajouter `margin-left: auto` au chevron**

Remplacer le bloc `.accord-chevron` existant (autour de la ligne 303) :

```css
.accord-chevron {
    color: var(--muted);
    flex-shrink: 0;
    transition: transform 250ms ease-out;
}
```

Par :

```css
.accord-chevron {
    color: var(--muted);
    flex-shrink: 0;
    margin-left: auto;
    transition: transform 250ms ease-out;
}
```

- [ ] **Step 3 : Ajouter les styles progressive disclosure après le bloc `.accord-chevron`**

Insérer après `.accord-section[data-open="true"] .accord-chevron { transform: rotate(180deg); }` :

```css
/* ── Badge Avancé ── */
.accord-badge {
    font-size: 9px;
    font-weight: 600;
    color: var(--muted);
    background: rgba(139, 148, 158, 0.12);
    border: 1px solid rgba(139, 148, 158, 0.20);
    border-radius: var(--radius-pill);
    padding: 2px 7px;
    white-space: nowrap;
    flex-shrink: 0;
}

/* ── Séparateur Paramètres avancés ── */
.form-advanced-sep {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0 4px;
}

.form-advanced-sep::before,
.form-advanced-sep::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-subtle);
}

.form-advanced-sep span {
    font-size: 9px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    white-space: nowrap;
}

/* ── Sections avancées — style atténué ── */
.accord-section:has(.accord-badge) {
    border-color: var(--border-subtle);
}

.accord-section:has(.accord-badge) .accord-title {
    color: var(--muted);
}

/* ── Fix overflow pour les tooltips dans les accordéons ouverts ── */
.accord-section[data-open="true"] .accord-body > fieldset {
    overflow: visible;
}
```

- [ ] **Step 4 : Vérifier visuellement dans le navigateur**

Ouvrir `index.html` via `python -m http.server 8080` puis `http://localhost:8080`.

Vérifier :
- Les sections accordéon s'ouvrent et se ferment correctement (animation inchangée)
- Le chevron reste à droite sur toutes les sections
- Aucun changement visuel sur les sections sans badge (pas de badge encore, sera ajouté en Task 3)

- [ ] **Step 5 : Commit**

```bash
git add styles.css
git commit -m "style: accordion layout + progressive disclosure base styles"
```

---

## Task 2 : CSS — Styles du tooltip field-hint

**Files:**
- Modify: `styles.css` (après le bloc `.field-required`, autour de la ligne 420)

- [ ] **Step 1 : Ajouter les règles `.field-hint` après `.field-required`**

Localiser le bloc `.field-required { color: var(--danger); }` (autour de la ligne 418) et insérer après :

```css
/* ── Bulle d'aide au survol ── */
.field-hint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 700;
    font-family: var(--font-body);
    cursor: help;
    position: relative;
    vertical-align: middle;
    flex-shrink: 0;
    transition: border-color 120ms, color 120ms;
    line-height: 1;
}

.field-hint:hover,
.field-hint:focus-visible {
    border-color: var(--primary);
    color: var(--primary);
    outline: none;
}

/* Flèche du tooltip */
.field-hint::before {
    content: '';
    position: absolute;
    top: calc(100% + 3px);
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-bottom-color: var(--border);
    z-index: 201;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms;
}

/* Corps du tooltip */
.field-hint::after {
    content: attr(data-tip);
    position: absolute;
    top: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 7px 10px;
    font-size: 11px;
    font-weight: 400;
    color: var(--text);
    line-height: 1.5;
    width: max-content;
    max-width: 260px;
    white-space: normal;
    text-align: left;
    text-transform: none;
    letter-spacing: 0;
    box-shadow: var(--shadow-soft);
    z-index: 200;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms;
}

.field-hint:hover::before,
.field-hint:hover::after,
.field-hint:focus-visible::before,
.field-hint:focus-visible::after {
    opacity: 1;
}
```

- [ ] **Step 2 : Vérifier dans le navigateur (pré-test — pas encore de boutons dans le HTML)**

Cette étape vérifie uniquement que les nouvelles règles CSS ne cassent pas le reste du site. Ouvrir `http://localhost:8080` et s'assurer que le formulaire s'affiche correctement.

- [ ] **Step 3 : Commit**

```bash
git add styles.css
git commit -m "style: field-hint tooltip CSS"
```

---

## Task 3 : HTML — Réordonnancement Fiscalité + séparateur + badges

**Files:**
- Modify: `index.html`

**Contexte :** Dans l'ordre actuel du HTML, Fiscalité (section essentielle) est intercalée après 3 sections avancées. On la déplace avant elles, puis on insère le séparateur.

Ordre actuel : Identité → Acquisition → Financement → Exploitation → Vérifications → Fiabilité → Seuils → **Fiscalité** → Journal

Ordre cible : Identité → Acquisition → Financement → Exploitation → **Fiscalité** → `[séparateur]` → Vérifications → Fiabilité → Seuils → Journal

- [ ] **Step 1 : Déplacer la section Fiscalité avant Vérifications avant offre**

Localiser le bloc Fiscalité (actuellement autour des lignes 312–331) :

```html
                            <div class="accord-section" data-open="false">
                                <button type="button" class="accord-head" aria-expanded="false">
                                    <span class="accord-title">Fiscalité</span>
                                    <svg class="accord-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                                </button>
                                <div class="accord-body">
                                <fieldset class="variables-group">
                                <div class="variables-grid variables-grid--single">
                                    <label class="variables-field" for="regime">
                                        <span class="status-label">Régime</span>
                                        <select id="regime" name="regime" class="variables-input">
                                            <option value="micro-foncier">Micro-foncier</option>
                                            <option value="reel">Foncier réel</option>
                                            <option value="sci-is">SCI à l'IS</option>
                                        </select>
                                    </label>
                                </div>
                            </fieldset>
                                </div>
                            </div>
```

Supprimer ce bloc de sa position actuelle et l'insérer juste après la section Exploitation locative (après son `</div>` fermant, actuellement autour de la ligne 188) :

Résultat attendu après Exploitation locative et avant Vérifications :

```html
                            </div>
                            <!-- [fin Exploitation locative] -->

                            <div class="accord-section" data-open="false">
                                <button type="button" class="accord-head" aria-expanded="false">
                                    <span class="accord-title">Fiscalité</span>
                                    <svg class="accord-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                                </button>
                                <div class="accord-body">
                                <fieldset class="variables-group">
                                <div class="variables-grid variables-grid--single">
                                    <label class="variables-field" for="regime">
                                        <span class="status-label">Régime</span>
                                        <select id="regime" name="regime" class="variables-input">
                                            <option value="micro-foncier">Micro-foncier</option>
                                            <option value="reel">Foncier réel</option>
                                            <option value="sci-is">SCI à l'IS</option>
                                        </select>
                                    </label>
                                </div>
                            </fieldset>
                                </div>
                            </div>

                            <div class="form-advanced-sep" aria-hidden="true">
                                <span>Paramètres avancés</span>
                            </div>

                            <!-- [Vérifications avant offre suit ici] -->
```

- [ ] **Step 2 : Ajouter le badge "Avancé" aux 4 sections avancées**

Pour chacune des 4 sections suivantes, insérer `<span class="accord-badge">Avancé</span>` entre `.accord-title` et `.accord-chevron` :

**Vérifications avant offre :**
```html
<button type="button" class="accord-head" aria-expanded="false">
    <span class="accord-title">Vérifications avant offre</span>
    <span class="accord-badge">Avancé</span>
    <svg class="accord-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
</button>
```

**Fiabilité des hypothèses :**
```html
<button type="button" class="accord-head" aria-expanded="false">
    <span class="accord-title">Fiabilité des hypothèses</span>
    <span class="accord-badge">Avancé</span>
    <svg class="accord-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
</button>
```

**Seuils de décision :**
```html
<button type="button" class="accord-head" aria-expanded="false">
    <span class="accord-title">Seuils de décision</span>
    <span class="accord-badge">Avancé</span>
    <svg class="accord-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
</button>
```

**Journal de décision :**
```html
<button type="button" class="accord-head" aria-expanded="false">
    <span class="accord-title">Journal de décision</span>
    <span class="accord-badge">Avancé</span>
    <svg class="accord-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
</button>
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Ouvrir `http://localhost:8080`. Vérifier :
- Le séparateur "PARAMÈTRES AVANCÉS" apparaît entre Fiscalité et Vérifications
- Les 4 sections avancées ont un badge "Avancé" gris à côté de leur titre
- Le chevron reste à droite sur toutes les sections
- Les accordéons s'ouvrent / se ferment correctement

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat: progressive disclosure — separator + advanced badges"
```

---

## Task 4 : HTML — Tooltips sur Identité du dossier + Acquisition (10 champs)

**Files:**
- Modify: `index.html`

**Pattern à appliquer** : insérer `<button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="[TEXTE]">?</button>` à l'intérieur du `<span class="status-label">`, juste avant la balise fermante `</span>`.

- [ ] **Step 1 : Ajouter les hints sur Identité du dossier (3 champs)**

```html
<!-- nom-bien -->
<span class="status-label">Nom du bien <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Nom libre pour identifier ce dossier dans votre comparateur et vos exports PDF.">?</button></span>

<!-- ville -->
<span class="status-label">Ville <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Ville où se situe le bien. Utilisée pour contextualiser l'analyse et le rapport.">?</button></span>

<!-- statut-bien -->
<span class="status-label">Statut <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Candidat = bien en cours d'étude. Acquis = bien déjà dans votre patrimoine.">?</button></span>
```

- [ ] **Step 2 : Ajouter les hints sur Acquisition (7 champs)**

```html
<!-- prix -->
<span class="status-label">Prix affiché <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Prix affiché par le vendeur, avant négociation. Point de départ du calcul du prix d'offre plafond.">?</button></span>

<!-- nego -->
<span class="status-label">Négociation visée <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Décote souhaitée sur le prix vendeur, en %. Le prix d'achat retenu sera prix × (1 − nego/100).">?</button></span>

<!-- loyer -->
<span class="status-label">Loyer cible mensuel <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Loyer mensuel hors charges prévu. Base de calcul du rendement brut et du cash-flow.">?</button></span>

<!-- notaire -->
<span class="status-label">Frais de notaire (%) <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Frais de notaire en % du prix. Environ 7–8 % dans l'ancien, 2–3 % dans le neuf.">?</button></span>

<!-- travaux -->
<span class="status-label">Budget travaux <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Budget travaux estimé, intégré au coût total d'acquisition et amortissable selon le régime fiscal.">?</button></span>

<!-- meubles -->
<span class="status-label">Budget mobilier <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Coût du mobilier pour une location meublée. Amortissable en LMNP et SCI IS.">?</button></span>

<!-- agence -->
<span class="status-label">Frais d'agence <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Honoraires d'agence immobilière à la charge de l'acquéreur. Intégrés au coût total.">?</button></span>
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Ouvrir la section Identité puis Acquisition dans le formulaire. Passer la souris sur chaque `?`. Vérifier :
- Le tooltip apparaît au survol avec le bon texte
- Il disparaît quand on quitte le `?`
- Le tooltip n'est pas coupé par l'accordéon ouvert
- L'icône `?` est alignée verticalement avec le label

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat: field-hint tooltips — Identité + Acquisition"
```

---

## Task 5 : HTML — Tooltips sur Financement + Exploitation locative (10 champs)

**Files:**
- Modify: `index.html`

- [ ] **Step 1 : Ajouter les hints sur Financement (5 champs)**

```html
<!-- apport -->
<span class="status-label">Apport <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Apport personnel en €. Réduit le capital emprunté et améliore le cash-flow.">?</button></span>

<!-- taux-input -->
<span class="status-label">Taux % <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Taux d'intérêt annuel du crédit immobilier, hors assurance. Comparer les offres bancaires.">?</button></span>

<!-- duree -->
<span class="status-label">Durée (ans) <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Durée du prêt en années. Plus longue = mensualité plus faible mais coût total plus élevé.">?</button></span>

<!-- assurance -->
<span class="status-label">Assurance % <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Taux d'assurance emprunteur annuel (ADI), en % du capital emprunté. Environ 0,20–0,40 %.">?</button></span>

<!-- frais-bancaires -->
<span class="status-label">Frais bancaires <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Frais de dossier bancaire et garantie (hypothèque ou caution). Généralement 1 000–2 000 €.">?</button></span>
```

- [ ] **Step 2 : Ajouter les hints sur Exploitation locative (5 champs)**

```html
<!-- vacance -->
<span class="status-label">Vacance (%) <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Taux de vacance locative estimé en %. 5 % = environ 18 jours sans locataire par an.">?</button></span>

<!-- copro -->
<span class="status-label">Charges de copro / mois <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Charges de copropriété mensuelles non récupérables sur le locataire, en €.">?</button></span>

<!-- fonciere -->
<span class="status-label">Taxe foncière / an <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Taxe foncière annuelle estimée. Vérifier l'avis le plus récent ou demander au vendeur.">?</button></span>

<!-- pno -->
<span class="status-label">Assurance PNO / an <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Prime d'assurance propriétaire non occupant (PNO) annuelle. Obligatoire en copropriété.">?</button></span>

<!-- gestion -->
<span class="status-label">Gestion % <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Honoraires de gestion locative, en % des loyers perçus. 0 si gestion en direct.">?</button></span>
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Ouvrir Financement puis Exploitation locative. Tester au moins 3 tooltips dans chaque section. Vérifier que les textes sont lisibles et correctement positionnés.

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat: field-hint tooltips — Financement + Exploitation locative"
```

---

## Task 6 : HTML — Tooltips sur Vérifications avant offre + Fiabilité des hypothèses (7 champs)

**Files:**
- Modify: `index.html`

- [ ] **Step 1 : Ajouter les hints sur Vérifications avant offre (3 champs)**

```html
<!-- dpe -->
<span class="status-label">DPE <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Classe énergétique du bien. Les passoires thermiques (F, G) seront soumises à restrictions de location d'ici 2025–2028.">?</button></span>

<!-- loyer-marche -->
<span class="status-label">Loyer de marché <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Loyer de marché constaté dans le secteur pour un bien comparable. Permet de vérifier la cohérence du loyer prévu.">?</button></span>

<!-- copro-risque -->
<span class="status-label">Risque copropriété <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Niveau de risque de la copropriété : stable = charges maîtrisées, medium = travaux prévisibles, high = situation dégradée.">?</button></span>
```

- [ ] **Step 2 : Ajouter les hints sur Fiabilité des hypothèses (4 champs)**

```html
<!-- source-loyer -->
<span class="status-label">Source du loyer <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Fiabilité de l'estimation du loyer : vérifié = annonces réelles récentes, estimé = approximation, inconnu = à vérifier.">?</button></span>

<!-- source-charges -->
<span class="status-label">Source des charges <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Fiabilité des charges renseignées : vérifié = documents comptables, estimé = approximation, inconnu = à vérifier.">?</button></span>

<!-- source-travaux -->
<span class="status-label">Source des travaux <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Fiabilité du budget travaux : vérifié = devis obtenu, estimé = estimation visuelle, inconnu = non évalué.">?</button></span>

<!-- source-documents -->
<span class="status-label">Source des documents <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Qualité des documents fournis par le vendeur (PV AG, charges, diagnostics) : vérifié, estimé ou inconnu.">?</button></span>
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Ouvrir les sections avancées (badge "Avancé" visible). Tester les tooltips. Vérifier que le style atténué des sections avancées est correct (titre plus gris, bordure plus subtile).

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat: field-hint tooltips — Vérifications + Fiabilité"
```

---

## Task 7 : HTML — Tooltips sur Seuils de décision + Fiscalité + Journal de décision (9 champs)

**Files:**
- Modify: `index.html`

- [ ] **Step 1 : Ajouter les hints sur Seuils de décision (6 champs)**

```html
<!-- seuil-cf-min -->
<span class="status-label">CF minimum / mois <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Cash-flow mensuel net minimum acceptable, en €. En dessous de ce seuil, le verdict vire à négatif.">?</button></span>

<!-- seuil-dscr-min -->
<span class="status-label">DSCR minimum <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="DSCR minimum (ratio loyer / mensualité). 1,0 = autofinancement, 1,2 = recommandé pour marge de sécurité.">?</button></span>

<!-- seuil-vacance-max -->
<span class="status-label">Vacance maximale (%) <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Taux de vacance maximum toléré, en %. Au-delà, le bien est considéré trop risqué.">?</button></span>

<!-- seuil-ecart-loyer-max -->
<span class="status-label">Écart max au marché (%) <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Écart maximum accepté entre loyer prévu et loyer de marché, en %. Détecte les loyers surévalués.">?</button></span>

<!-- seuil-effort-max -->
<span class="status-label">Effort maximal du foyer (%) <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Taux d'effort maximum (mensualité / revenus nets), en %. Limite l'endettement personnel.">?</button></span>

<!-- blocage-passoire -->
<span class="status-label">Blocage passoire thermique <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Si activé, un DPE F ou G bloque automatiquement le verdict à négatif, quelle que soit la rentabilité.">?</button></span>
```

- [ ] **Step 2 : Ajouter le hint sur Fiscalité (1 champ)**

```html
<!-- regime -->
<span class="status-label">Régime <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Régime fiscal de la location : Micro-foncier (abattement 30 %), Réel (déduction charges réelles), SCI IS (imposition société).">?</button></span>
```

- [ ] **Step 3 : Ajouter les hints sur Journal de décision (2 champs)**

Note : ces deux champs ont déjà un `.field-assist` et un `.field-error`. Le `.field-hint` va dans le `.status-label`, qui contient aussi `.field-required`. Insérer le bouton après le texte du label et avant `</span>` :

```html
<!-- decision-thesis -->
<span class="status-label">Thèse d'investissement <span class="field-required" aria-hidden="true">*</span> <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Résumez en quelques mots pourquoi vous étudiez ce bien. Requis pour enregistrer le dossier (20 caractères min).">?</button></span>

<!-- decision-next-step -->
<span class="status-label">Prochaine étape <span class="field-required" aria-hidden="true">*</span> <button class="field-hint" type="button" tabindex="-1" aria-label="Aide" data-tip="Prochaine action concrète à mener sur ce dossier (visite, devis, offre…). Requis pour enregistrer (10 caractères min).">?</button></span>
```

- [ ] **Step 4 : Vérification finale complète**

Ouvrir `http://localhost:8080`. Parcourir toutes les 9 sections accordéon dans l'ordre :

1. Identité → ouvrir → tester 3 tooltips (nom-bien, ville, statut)
2. Acquisition → ouvrir → tester prix, loyer
3. Financement → ouvrir → tester taux, durée
4. Exploitation → ouvrir → tester vacance, gestion
5. Fiscalité → ouvrir → tester régime
6. Séparateur "PARAMÈTRES AVANCÉS" → vérifier qu'il est visible
7. Vérifications → badge "Avancé" visible, ouvrir → tester DPE
8. Fiabilité → badge "Avancé" visible, ouvrir → tester source-loyer
9. Seuils → badge "Avancé" visible, ouvrir → tester seuil-cf-min
10. Journal → badge "Avancé" visible, ouvrir → tester decision-thesis (tooltip visible malgré le .field-assist déjà présent)

Vérifier aussi en light mode (cliquer sur le toggle de thème en haut) : le tooltip doit être lisible sur fond blanc.

- [ ] **Step 5 : Commit final**

```bash
git add index.html
git commit -m "feat: field-hint tooltips — Seuils + Fiscalité + Journal (tous les 36 champs)"
```
