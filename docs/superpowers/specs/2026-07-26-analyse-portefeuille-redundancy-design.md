# Analyse & Portefeuille — réduction de la redondance visuelle (design)

## Contexte

Suite à un audit UX esthétique/ergonomie (données réalistes injectées, captures d'écran, dark theme), deux problèmes concrets ont été identifiés :

1. **Analyse** : le verdict d'achat (score, prix plafond, action recommandée) est rendu par **4 fonctions différentes** dans `main.js`, produisant 4 cartes quasi identiques en descendant la page :
   - `buildWorkspaceHero` — carte en haut de page
   - `buildAnalysisStickySummary` ("Tableau de bord décisionnel") — déclarée `position: sticky` en CSS mais ne colle pas à l'usage
   - `buildAnalysisAcquisitionDecision` ("Décision d'achat" / buybox) — version complète (jauge, points forts/faibles)
   - `buildAnalysisMetrics` ("Économie du deal") — grille de 9 KPI qui re-liste une bonne partie des mêmes chiffres

   Séparément, `buildAnalysisSummary` ("Décision d'exploitation") est un verdict légitimement différent (viabilité de l'exploitation, distinct du prix d'achat) mais son titre s'affiche deux fois de suite (badge de section + libellé interne dupliqué).

2. **Portefeuille** : la fiche détail d'un bien a un bandeau persistant (régime fiscal, alertes, synthèse, comparatif régimes — rendu une fois par `renderOwnedDetail`, pas dupliqué en soi) au-dessus de 4 onglets (Acquisition/Exploitation/Travaux/Projection). Changer d'onglet oblige à re-scroller devant ce bandeau (~700-900px) à chaque fois.

## Cause racine (commune aux deux)

`.workspace-panel { overflow: hidden; }` (`styles.css:1743`) est l'ancêtre commun du panneau Analyse (`#analysis-panel`) et du panneau Portefeuille (`#collection-panel`). N'importe quelle valeur d'`overflow` autre que `visible` sur un ancêtre transforme cet ancêtre en conteneur de scroll potentiel aux yeux du moteur de rendu, ce qui casse `position: sticky` pour tous ses descendants — même si cet ancêtre ne scrolle jamais lui-même visuellement.

C'est exactement la même classe de bug déjà corrigée dans ce repo (commit `9ce4b59`, sur `body { overflow-x: hidden }` cassant la sidebar sticky). Le correctif déjà validé : remplacer `hidden` par `clip`, qui produit le même rendu visuel (le contenu/dégradé reste rogné aux coins arrondis) sans établir de conteneur de scroll fantôme.

## Changements

### 1. CSS — `styles.css`
- `.workspace-panel { overflow: hidden }` → `overflow: clip`.

### 2. Analyse — `main.js`
- `buildAnalysisStickySummary` : réduire le contenu à une bande compacte à une ligne (badge de décision + score + action recommandée), en retirant les 4 mini-KPI (Score/Offre cible/Prix affiché/Baisse à viser) déjà présents dans la carte "Décision d'achat" juste en dessous. Une fois réellement épinglée (grâce au fix CSS), elle n'a plus besoin d'être une carte complète : son rôle devient "rappel permanent pendant qu'on lit le détail plus bas", pas une 3ᵉ répétition intégrale.
- `buildAnalysisMetrics` ("Économie du deal") : retirer les cartes `Offre plafond`, `Score décision`, `Seuil favorable`, `Résistance` (100 % redondantes avec `buildAnalysisAcquisitionDecision`). Conserver `Cash-flow net-net`, `CF avant impôt`, `Rentabilité brute`, `DSCR`, `Fiabilité` — ce sont des chiffres bruts qui n'apparaissent nulle part ailleurs sous cette forme "grille + barre de progression".
- `buildAnalysisSummary` ("Décision d'exploitation") : retirer le `<span class="status-label">Décision d'exploitation</span>` interne, redondant avec le badge de section qui l'entoure déjà.
- `buildAnalysisAcquisitionDecision` et `buildWorkspaceHero` : **inchangés** (carte de référence détaillée / premier coup d'œil).

### 3. Portefeuille — `owned-portfolio.js` / `styles.css`
- Rendre `.owned-tabs` (la barre d'onglets Acquisition/Exploitation/Travaux/Projection) `position: sticky` (même mécanisme, maintenant débloqué par le fix CSS).
- Corriger le champ fichier tronqué dans l'onglet Travaux (`renderOwnedTravauxTab`) — élargir la zone du nom de fichier ou tronquer proprement avec ellipsis au lieu de couper "No file chosen" en "No...en".

## Hors périmètre

- `buildAnalysisSummary` ("Décision d'exploitation") reste un verdict séparé — ce n'est pas une redondance à supprimer, seulement son titre dupliqué.
- Le bandeau persistant du Portefeuille (régime/alertes/synthèse) n'est pas raccourci ni rendu masquable — seule la barre d'onglets devient sticky pour réduire le besoin de re-scroller.
- Aucun changement de logique de calcul (`calculs.js`) — uniquement du rendu HTML/CSS.

## Vérification

- Captures d'écran avant/après (Playwright déjà en place, données de test déjà seedées) pour confirmer visuellement la réduction de redondance et le bon comportement sticky.
- `verify.bat` (pytest + tests JS) doit continuer à passer sans modification attendue (aucun changement de `calculs.js`/`scraper`).
