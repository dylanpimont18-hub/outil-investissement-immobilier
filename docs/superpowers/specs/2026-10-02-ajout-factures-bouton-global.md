# Ajout de factures en un geste — bouton flottant global, modale unique, extraction IA par lot

> Révision du 2026-10-02 (même jour) : la première version de cette spec décrivait une boîte de réception persistante (collection Firestore `factures`, onglet dédié, rattachement différé). L'utilisateur a préféré un **bouton d'action rapide présent sur toutes les pages** où l'on choisit le bien, les fichiers ou un dossier, et où l'on lance l'ajout — sans stockage intermédiaire. C'est cette version qui est implémentée.

## Contexte

Le Portefeuille sait déjà lire une facture par IA (`extraireFraisFacture`, `functions/index.js`) et pré-remplir un frais : zone de dépôt dans l'onglet « Frais & justificatifs » d'un bien (1 fichier, ou 2+ via `openTravauxBatchModal`), rail « Ajouter une facture » sur PC (`initOwnedQuickRail`) et bouton flottant 📄 sur iPhone (`initOwnedQuickFab`), ces deux derniers partageant `_wireQuickFactureForm`.

Limites constatées le 2026-10-02 :

1. **Trois chemins différents** pour la même action, dont deux formulaires « un fichier à la fois » (rail PC, modale iPhone). Pas de dépôt de dossier hors import de dossier bien.
2. Le bouton d'ajout n'existe que dans le Portefeuille (PC) : depuis l'onglet Analyse ou Assistant il faut naviguer d'abord.
3. **Bug réel** : les trois flux factures (`owned-portfolio.js:2717`, `:3745`, `:3935`) envoient `file.type` tel quel à la Cloud Function, qui refuse `application/pdf` depuis le passage à Mammouth AI (2026-08-04). La conversion PDF→PNG côté client (`_pdfFirstPageToPngFile`) n'est utilisée que par l'import de dossier bien. Toute facture PDF échoue silencieusement (« extraction impossible, remplis à la main »).
4. Au moment d'ajouter, aucune vue des factures **déjà** enregistrées sur le bien : doublons et oublis ne se voient qu'après coup dans l'onglet Frais.

## Objectif

Un **bouton flottant 📄 « Ajouter des factures »** visible sur toutes les pages (PC `index.html` et iPhone `owned.html`), qui ouvre **une seule modale** : choisir le bien, déposer fichiers/photos/dossier, voir les lignes se remplir par l'IA (**fournisseur, résumé court, montant, date d'émission**), vérifier d'un coup d'œil à côté des factures déjà enregistrées sur ce bien, et valider en un clic. Aperçu plein écran de n'importe quelle facture, en cours ou déjà stockée.

Principe directeur : **ultra simple et intuitif**. Une seule logique d'ajout ; les deux formulaires rapides existants disparaissent. La zone de dépôt **dans** la fiche d'un bien est conservée (le bien est déjà connu) et profite du correctif PDF.

## Hors périmètre

- Stockage intermédiaire (boîte de réception persistante) : fermer la modale perd les lignes non ajoutées, choix assumé.
- Nouveau champ `fournisseur` sur le modèle `travail` : la description du frais devient `Fournisseur — résumé`, visible et éditable partout sans toucher aux rendus Travaux/PDF/rapport/Assistant.
- Ajout automatique sans confirmation : un montant mal lu part dans la déduction fiscale, la revue coûte un clic. (Évolution possible, ~10 lignes.)
- Lecture multi-pages d'un PDF (première page uniquement, comme l'import de dossier).
- Modification du quota IA (30 lectures image/heure/uid).

## Parcours utilisateur

### Bouton flottant

- `owned.html` : `#owned-quickfab` existant, conservé (liste et fiche).
- `index.html` : nouveau `#owned-quickfab` identique, visible sur tous les onglets (Analyse, Portefeuille, Assistant…), masqué dans la fenêtre d'analyse détachée (`IS_ANALYSIS_WINDOW`) et tant que le portefeuille cloud n'est pas chargé (pas connecté → clic = toast « Connecte-toi au portefeuille d'abord » + bascule sur l'onglet Portefeuille).
- Rail PC « Ajouter une facture » : ouvre la même modale (panneau inline `data-quickpanel="add-facture"` supprimé).

### Modale « Ajouter des factures »

```
┌ Ajouter des factures ──────────────────────────────────── ✕ ┐
│ Bien : [ Rue des Lilas ▾ ]                                   │
│ ┌────────────────────────────────────────────────────────┐   │
│ │  ⤓  Glisse des fichiers ou un dossier entier           │   │
│ │     [ Choisir des fichiers ]  [ Choisir un dossier ]   │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ EN COURS D'AJOUT (3)                                         │
│ [img] ☑ Leroy Merlin · Peinture salon   1 240 €  émise 12/09/2026  👁 │
│ [pdf] ☑ Plombier Martin · Chauffe-eau     380 €  émise 03/09/2026  👁 │
│ [img] ☐ IMG_2041.jpg — Lecture…                                  👁 │
│                                     [ Ajouter les 2 frais ]  │
│                                                              │
│ DÉJÀ ENREGISTRÉES SUR CE BIEN (12)              ▾ replier    │
│ 28/08/2026  Castorama — Parquet chambre       890 €      📄  │
│ 15/07/2026  Électricien Dupont — Tableau      1 450 €    📄  │
│ … voir les 9 autres                                          │
└──────────────────────────────────────────────────────────────┘
```

**Bien** : sélecteur en tête. Pré-sélection : le bien dont la fiche est ouverte, sinon le dernier bien utilisé dans cette modale (`localStorage`), sinon le premier de l'ordre du portefeuille. Changer de bien ré-évalue les doublons des lignes en cours et recharge la liste du bas.

**Dépôt** : glisser-déposer fichiers **ou dossiers** (parcours récursif), « Choisir des fichiers » (`multiple`), « Choisir un dossier » (`webkitdirectory`, masqué sur iOS qui ne le supporte pas). Sur iPhone, taper la zone ouvre le sélecteur natif (« Prendre une photo / Galerie / Fichiers », `accept="application/pdf,image/*"`, `multiple`). Formats `.pdf/.jpg/.jpeg/.png` ; autres ignorés avec un toast récapitulatif ; fichiers cachés (préfixe `.`) ignorés silencieusement ; 8 Mo max par fichier (`TRAVAUX_MAX_FILE_SIZE`) ; 50 fichiers max par dépôt (toast). Plusieurs dépôts successifs s'ajoutent à la liste en cours.

**En cours d'ajout** — une ligne par fichier, dès le dépôt :

- Vignette : photo → miniature (`URL.createObjectURL`) ; PDF → la première page rasterisée pour l'IA (déjà calculée) sert de miniature ; en attendant, icône.
- Case à cocher · **fournisseur** · **résumé court** · **montant** · **date d'émission** (libellé « émise le ») · tag fiscal (sélecteur compact) · bouton 👁 (aperçu plein écran du fichier local, `openDocumentPreview` généralisé à une URL directe).
- Extraction IA en parallèle (concurrence 3). Statuts : « Lecture… » (champs grisés) → remplie (case cochée automatiquement si date + description + montant présents) ; « Quota IA atteint — réessaie dans une heure » ou « Lecture impossible — complète à la main » (case décochée, champs éditables, bouton « Relire »).
- Toute valeur éditable sur la ligne (`change`). Une ligne complète reste cochable à la main même après erreur.
- **Doublon probable** (`findSimilarTravail` sur le bien sélectionné, ±2 € / ±5 j, ré-évalué à chaque changement de bien/montant/date) : bandeau non bloquant sur la ligne, **case décochée par défaut**, et la ligne existante correspondante est surlignée dans la liste du bas.
- Bouton **« Ajouter les N frais »** (N = lignes cochées et complètes, en direct ; désactivé à 0). Ajout séquentiel : upload de l'original + `addOwnedTravail` par ligne — description `Fournisseur — résumé` (ou le résumé seul si fournisseur vide). Les lignes ajoutées quittent la liste en cours et apparaissent dans la liste du bas ; les lignes non cochées restent. Toast « N frais ajoutés à <bien> ». La modale reste ouverte (nouvelle fournée possible), ✕ ferme. Si la fiche du bien est ouverte derrière, son onglet Frais est rafraîchi.

**Déjà enregistrées sur ce bien** — tous les frais du bien (`postAchat.travaux`), tri date d'émission décroissante : date · description · montant · 📄 (aperçu du justificatif stocké via `openDocumentPreview(assetId, pdfFilename)`, tiret si aucun). 10 dernières lignes visibles, « voir les N autres » déplie. Section `<details>` : ouverte par défaut sur PC, repliée sur iPhone (`IS_MOBILE_PAGE`). État vide : « Aucun frais enregistré sur ce bien ».

## Extraction IA

### Pipeline client partagé

Nouvelle fonction module-scope `_prepareFactureImage(file)` dans `owned-portfolio.js` : PDF → `_pdfFirstPageToPngFile` (existant), JPG/PNG → tel quel ; retourne `{ base64, mimeType, imageFile }` (`imageFile` réutilisé comme miniature). Adoptée par la modale **et** par le flux 1 fichier de l'onglet Travaux (`handleFile` dans `renderOwnedTravauxTab`) : correction du bug PDF. L'original (PDF compris) reste le justificatif stocké.

### Cloud Function `extraireFraisFacture` (étendue, rétrocompatible)

Entrée inchangée (`{ base64, mimeType }`). Prompt système complété :

- `"fournisseur"` : nom de l'entreprise émettrice, `""` si illisible.
- `"description"` : résumé **très court** de la prestation (3 à 8 mots), **sans** répéter le fournisseur.
- `"date"` : date d'**émission** de la facture (pas la date d'échéance ni de livraison).

Sortie nettoyée : `fournisseur` chaîne ≤ 120 caractères ajoutée ; le reste identique. Appelants existants : réponse identique plus `fournisseur`.

Quota, taille, auth, User-Agent : inchangés.

## Architecture

- `owned-portfolio.js` :
  - `openTravauxBatchModal(files)` (fermée sur l'asset courant) devient **`openAjoutFacturesModal({ assetId = null, files = [] })`**, exportée ; sélecteur de bien + zone de dépôt + deux listes intégrés. Le dépôt de 2+ fichiers dans l'onglet Travaux l'appelle avec `assetId` fixé et `files` pré-remplis (sélecteur verrouillé sur ce bien).
  - `_collectDroppedFiles(dataTransfer)` : `webkitGetAsEntry()` récursif, `readEntries` en boucle jusqu'à un lot vide, repli `dataTransfer.files`.
  - `openDocumentPreview(assetId, filename)` accepte aussi `openDocumentPreview(null, null, { url, mimeType })` pour un fichier local.
  - `initOwnedQuickFab()` : présent sur les deux pages, clic → `openAjoutFacturesModal({ assetId: state.activeOwnedAssetId || null })`. `initOwnedQuickRail()` : action `add-facture` → même appel. Suppression de `_populateQuickAssetSelect`, `_refreshAfterQuickFacture`, `_wireQuickFactureForm`.
- `index.html` : bouton `#owned-quickfab` ajouté hors `#collection-panel` (visible sur tous les onglets) ; panneau `data-quickpanel="add-facture"` retiré. `owned.html` : `#owned-quickfab-modal` retiré (la modale est construite par `_showOwnedModal` comme les autres).
- `styles.css` : `.owned-quickfab` étendu au PC (même position, taille 52 px, masqué à l'impression) ; classes `.owned-facturesmodal*` (en-tête bien + dropzone, liste en cours en lignes, liste existante compacte, ligne surlignée doublon) ; `@media (max-width: 480px)` → lignes en cartes empilées, cibles ≥ 44 px (pas `.shell--owned`, hors arbre).
- `functions/index.js` : prompt + nettoyage `fournisseur`.
- `CODEBASE_MAP.md` : entrées `owned-portfolio.js`, `index.html`, `owned.html`, `styles.css`, `functions/index.js`.

## Gestion des erreurs

| Situation | Comportement |
|---|---|
| Portefeuille non chargé / non connecté | Clic FAB → toast + onglet Portefeuille |
| Aucun bien | Modale avec message « Crée d'abord un bien » et bouton vers l'ajout de bien |
| Fichier > 8 Mo ou format inconnu | Ignoré, toast récapitulatif |
| Conversion PDF impossible | Ligne « Lecture impossible », icône PDF, saisie manuelle |
| Quota IA (`resource-exhausted`) | Ligne « Quota IA atteint », bouton Relire |
| Autre erreur IA / réseau | Ligne « Lecture impossible », bouton Relire |
| Upload d'un original échoue | Toast, ligne reste en cours, les autres continuent |
| Bien supprimé pendant la modale | Sélecteur recalculé au prochain rendu, ajout refusé avec toast |

## Vérification

- `npm test` (aucune modification de `calculs.js`, doit rester vert — `build.bat` l'exige).
- `node -e "require('./functions/index.js')"` puis `firebase deploy --only functions`.
- **Playwright**, `python server.py`, stub `owned-cloud.js` (`cloudExtraireFraisFacture` renvoie une réponse fixe après 50 ms ou rejette avec `code: 'functions/resource-exhausted'` selon un drapeau ; `cloudUploadDocument` renvoie un nom ; `watchOwnedAssets` alimente un bien avec 2 frais existants) :
  - PC `index.html`, depuis l'onglet **Analyse** : FAB visible → modale → bien pré-sélectionné → dépôt de 3 fichiers (1 PDF généré + 2 PNG) → lignes « Lecture… » → remplies avec fournisseur/résumé/montant/date, PDF envoyé en `image/png` → doublon décoché + ligne existante surlignée → édition du montant → « Ajouter les 2 frais » → frais présents sur le bien avec `pdfFilename`, lignes passées dans la liste du bas → 👁 ouvre l'overlay → quota → message + Relire.
  - iPhone `owned.html` 393×852 : FAB depuis la liste et depuis une fiche (bien pré-sélectionné), lignes lisibles sans débordement horizontal, boutons ≥ 44 px, section du bas repliée.
  - Non-régression : onglet Travaux d'un bien, dépôt d'un PDF seul → extraction appelée avec `image/png` ; dépôt de 2 fichiers → nouvelle modale avec bien verrouillé.
  - `pageerror`/`console` vides.
- Test réel après déploiement par l'utilisateur (PDF et photo) — seule validation possible du prompt étendu.

## Livraison

1. Commit(s) de la fonctionnalité (`VERSION` 1.0.17 en attente inclus).
2. `git push`.
3. `firebase deploy --only functions,hosting`.
4. `update-and-run.bat` → rebuild exe (auto-bump 1.0.18), vérifier que `Spark/*.js` contient bien tous les modules.
