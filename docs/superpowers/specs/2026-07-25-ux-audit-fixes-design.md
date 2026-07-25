# Corrections UX — audit du parcours utilisateur (2026-07-25)

## Contexte

Audit UX mené en pilotant l'app réellement (Flask + Playwright) plutôt qu'en lisant seulement le code. Trois problèmes confirmés, un déjà corrigé, deux restent à implémenter.

## 1. Bug sticky sidebar — CORRIGÉ

`body { overflow-x: hidden }` (styles.css:199) forçait `overflow-y` à se calculer en `auto`, transformant `<body>` en conteneur de scroll parasite et cassant `position: sticky` pour tous les éléments de l'app. Remplacé par `overflow-x: clip` (ne déclenche pas cet effet de bord). Vérifié en direct : la sidebar reste épinglée à `top: 80px` après un scroll de 6000px, à toutes les largeurs testées (1400×900, 900×600), sans scrollbar horizontale parasite.

Pas de plan d'implémentation nécessaire pour ce point — déjà fait et vérifié.

## 2. Vue rapide condensée (page Analyse)

**Problème** : même en "Vue rapide" (mode par défaut), la page Analyse fait ~7500px de haut — l'utilisateur ne voit jamais un dossier "d'un coup d'œil".

**Mécanisme existant** : `#analysis-panel[data-analysis-view]` est déjà utilisé en CSS pour masquer 3 sections en mode "quick" (`.analysis-forward`, `.analysis-section--sensitivity`, `.analysis-section--cashflow`). Il suffit d'étendre les règles CSS existantes (styles.css ~8778) — aucun changement de calcul ni de structure HTML.

**Sections à ajouter au masquage en mode "quick"**, visibles seulement en "Vue complète" :
- Bloc "③ Robustesse" complet : `#analysis-confidence` (Solidité des hypothèses) et `#analysis-details` (Vue détaillée)
- `#analysis-scenarios` (Scénarios de stress)
- `#analysis-regime-table` (Régimes fiscaux)
- `#analysis-journal` (Journal de décision) — mais **pas** `#analysis-action-plan` (Leviers prioritaires), qui reste visible en Vue rapide

Aucune de ces sections n'a aujourd'hui de mécanisme de repli (ce sont des `<section class="analysis-block">` fixes, pas des accordéons). Pour respecter "repliées par défaut, ouvertes sur clic" en Vue complète, ces sections (plus celles déjà masquées en quick : sensibilité, projection/matrice, régimes fiscaux, cash-flow annuel) sont converties en `<details><summary>Titre</summary>...</details>` natif HTML — fermé par défaut (pas d'attribut `open`), sans JS ni dépendance nouvelle. Le style visuel du `<summary>` reprend l'apparence actuelle du `<h4>` de section.

**Sections supprimées de la Vue rapide** (redondance avec le waterfall, chiffres identiques présentés différemment) :
- `#analysis-monthly-chart` (Répartition mensuelle)
- `#analysis-cost-chart` (Structure du coût d'entrée)

**Restent visibles en Vue rapide** : sticky summary, ① Verdict (buybox), waterfall cash-flow, grille de 9 KPI, carte "Décision d'exploitation", Leviers prioritaires.

**Contrainte de layout** : les blocs masqués vivent parfois dans des `.analysis-columns--2up` (grid 2 colonnes) aux côtés d'un bloc qui reste visible (ex. "Journal de décision" masqué / "Leviers prioritaires" visible, dans le même `.analysis-columns--2up`). Il faut que la règle CSS fasse aussi passer ce conteneur en 1 colonne quand un des deux enfants est masqué, sinon "Leviers prioritaires" se retrouve avec une colonne vide à côté.

**Résultat attendu** : réduction d'environ 65% de la hauteur de la Vue rapide (visée ~2-3 écrans, pas 1 seul — accepté par l'utilisateur).

## 3. Étude vierge par défaut + skip du profil

### 3a. Valeurs par défaut

Dans `VARIABLE_DEFAULTS` (main.js ~300), les clés suivantes passent à `0` (ou `''` pour un champ texte) au lieu de leur valeur actuelle :
- `prix`: 107000 → 0
- `loyer`: 700 → 0
- `travaux`: 5000 → 0
- `meubles`: 4000 → 0
- `agence`: 0 → (déjà 0, inchangé)
- `loyer-marche`: 700 → 0

Toutes les autres clés (taux, durée, notaire %, vacance, gestion, assurance, frais bancaires, taxe foncière, copro, pno, seuils de décision, dpe, régime, sources...) restent des valeurs par défaut génériques inchangées — ce sont de vraies hypothèses par défaut utiles, pas des données d'un bien fictif.

### 3b. État neutre tant que prix/loyer sont vides

Tant que `prix <= 0` ou `loyer <= 0` : le hero (`workspace-hero`), le buybox (`analysis-acquisition-decision`) et le sticky summary (`analysis-sticky-summary`) affichent un état neutre "Renseignez le prix et le loyer pour lancer l'analyse" au lieu du verdict calculé. Implémenté comme une garde dans les fonctions de rendu de `main.js` (avant l'appel au rendu normal du view-model) — `calculs.js` reste inchangé et ignore cette notion d'état "vide" (respect de la contrainte CLAUDE.md : `calculs.js` reste pur, sans notion de présentation).

Le reste du formulaire (accordéons Financement, Exploitation, Fiscalité, Avancé) n'est pas affecté — seuls les 6 champs listés en 3a changent de valeur par défaut.

### 3c. Skip du modal Profil

Ajout d'un bouton "Plus tard" dans `#profile-modal` (index.html ~1183, à côté du bouton `#profile-close` déjà présent mais cousinent : ce dernier reste caché tant que non configuré — comportement inchangé), visible uniquement quand `!state.profileConfigured`. Son handler appelle `dismissProfileModal()` directement (sans passer par `closeProfileModal()` / `canDismissProfileModal()`, et sans appeler `setProfileConfigured()`) : le modal se ferme, mais le badge topbar "Configuration requise pour les calculs" reste affiché, et le modal se rouvrira au prochain lancement (comportement déjà existant piloté par `!state.profileConfigured`, inchangé).

La touche Échap suit la même règle : le handler global (main.js ~6650) appelle aujourd'hui `closeProfileModal()` qui bloque tant que non configuré — on le fait appeler `dismissProfileModal()` directement, comme le bouton "Plus tard".

## Hors périmètre de ce spec

Fonctionnalité demandée en parallèle par l'utilisateur — factures PDF pour travaux/taxes dans le portefeuille + calcul fiscal auto-projeté sur les années futures — traitée dans un spec séparé (sujet indépendant, plus large).
