# Import de dossier bien — extraction multi-documents fusionnée

## Contexte

Le Portefeuille sait déjà extraire une facture de travaux isolée via l'IA (`extraireFraisFacture`, `functions/index.js`), avec un flux groupé pour plusieurs factures à la fois (`openTravauxBatchModal`, cf. `docs/superpowers/specs/2026-08-04-travaux-import-groupe.md`). Mais créer ou compléter un bien reste un remplissage champ par champ (accordéon Acquisition/Exploitation) : prix, frais de notaire, taux de crédit, taxe foncière, etc. — alors que l'utilisateur possède déjà la plupart de ces informations dans les documents papier/PDF de son achat (acte de vente, offre de prêt, tableau d'amortissement, avis de taxe foncière, appel de charges copro, attestation PNO).

## Objectif

Sélectionner un dossier entier de documents liés à un bien, faire extraire chacun par l'IA, fusionner les résultats en un seul jeu de valeurs cohérent, et pré-remplir la fiche bien (nouvelle création ou bien existant) en une seule validation — au lieu de N ressaisies manuelles.

## Sélection et conversion

`<input type="file" webkitdirectory multiple hidden>` déclenché par un bouton "Importer un dossier". Les fichiers du dossier sont filtrés par extension (`.pdf`, `.jpg`, `.jpeg`, `.png`) ; les autres types sont ignorés silencieusement (pas de ligne, pas d'erreur).

Mammouth AI (le fournisseur derrière `extraireFraisFacture`/`extraireDossierBien`) n'accepte que `image/jpeg`/`image/png` côté serveur (cf. commentaire `functions/index.js:7-10`). Les PDF du dossier sont donc convertis côté client avant envoi :

- Dépendance `pdfjs-dist`, servie localement (cohérent avec le fonctionnement 100% local de l'app, pas de CDN externe)
- Rendu de la **première page uniquement** sur un `<canvas>` hors-écran (échelle ~2x pour la lisibilité OCR), puis `canvas.toBlob('image/png')`
- Limite acceptée : un acte de plusieurs pages perd les pages suivantes — les informations clés (prix, date, parties, surface) sont presque toujours en première page pour les documents visés ; à revoir seulement si un besoin réel se manifeste
- Échec de conversion (PDF chiffré, scan illisible) → document marqué "non traité", n'interrompt pas le reste du dossier

Le PNG résultant rejoint ensuite le même pipeline que les JPG/PNG natifs du dossier (vérification de la limite de 5 Mo de la Cloud Function).

## Cloud Function `extraireDossierBien`

Nouvelle fonction dans `functions/index.js`, sur le modèle d'`extraireFraisFacture` :

- **System prompt** : celui fourni par l'utilisateur, repris tel quel — extraction structurée par type de document (`documentType`), avec sous-objets `bien`/`acquisition`/`credit`/`charges`/`travail` et un champ `confiance` global par document. Règle stricte : aucune valeur inventée, champ absent = omis (jamais `0`/`null` par défaut).
- **Garde-fous identiques** à l'existant : auth obligatoire (`request.auth`), validation stricte `base64`/`mimeType` (JPEG/PNG uniquement, PDF déjà convertis en amont), limite 5 Mo, `timeoutSeconds: 60` (un document par appel, comme aujourd'hui).
- **Rate limiter partagé** avec `extraireFraisFacture` (même `Map` en mémoire par uid, même fenêtre glissante 1h) — plafond relevé de **10 à 30 appels/heure/uid** pour absorber un dossier de 15-20 documents en plus de l'usage Travaux normal à côté. Changement de paramètre de sécurité fait avec l'accord explicite de l'utilisateur.
- Sortie validée/nettoyée champ par champ comme l'existant (allowlist sur `documentType`/`confiance`, types numériques vérifiés) avant retour au client — jamais de confiance aveugle dans le JSON renvoyé par Mammouth.

## Fusion multi-documents

Les champs `bien`/`acquisition`/`credit`/`charges` de chaque document sont regroupés par chemin logique (ex. `acquisition.prix`, `credit.taux`, `charges.taxeFonciere`). Règle de fusion par champ :

- Un seul document renseigne ce champ → valeur retenue directement, provenance = ce document.
- Plusieurs documents renseignent le même champ avec des valeurs différentes → la valeur du document à la **confiance la plus haute** gagne (haute > moyenne > basse ; égalité → premier document traité dans l'ordre du tableau qui gagne).
- Chaque valeur retenue garde en mémoire sa provenance (nom du fichier + niveau de confiance) pour affichage dans le tableau de revue.

Le sous-objet `travail` de chaque document ne participe pas à cette fusion : chaque document de type `facture_travaux` devient une ligne indépendante dans un bloc "Travaux détectés" séparé, sur le même principe que `openTravauxBatchModal` (une ligne par facture, pas de fusion de champs entre factures).

## Tableau de revue

Modale unique (`_showOwnedModal`), réutilisant `_runWithConcurrencyLimit(fichiers, 3, ...)` pour l'extraction (même concurrence que le batch Travaux existant), avec trois blocs :

1. **Bloc "Bien"** — une ligne par champ retenu après fusion, éditable, avec document source et niveau de confiance affichés. Un champ ayant eu un conflit résolu automatiquement porte une puce discrète ("2 sources, confiance la plus haute retenue") consultable au survol/tap.
2. **Bloc "Travaux détectés"** — une ligne éditable par facture de travaux identifiée, avec case à cocher d'inclusion individuelle (même pattern que le batch Travaux actuel).
3. **Bloc "Non traités"** (replié par défaut) — documents en échec d'extraction ou de conversion PDF, avec la raison. N'empêche pas la validation du reste du dossier.

Si l'import est lancé depuis un **bien déjà existant**, tout champ du bloc "Bien" qui a une valeur non vide sur le bien actuel affiche cette valeur actuelle à côté de la valeur extraite ("valeur actuelle : X") — l'utilisateur choisit explicitement de remplacer ou garder, jamais d'écrasement silencieux d'une saisie manuelle.

## Points d'entrée

Deux boutons "Importer un dossier", ouvrant la même modale :

1. **Écran de création** (`openOwnedQuickPanel('add-bien')`) — à côté du mini-formulaire nom/ville existant. Le dossier peut être analysé avant la création du bien ; `nom`/`ville` détectés pré-remplissent le mini-formulaire, sinon saisie manuelle inchangée avant validation.
2. **Fiche bien existante** — bouton dans l'accordéon Acquisition, pour compléter un bien avec des documents retrouvés après coup.

## Validation et écriture

Un bouton "Valider l'import" déclenche, dans l'ordre :

1. Si nouveau bien : `createOwnedAsset(nom, ville)` (valeurs du mini-formulaire, éventuellement pré-remplies par la fusion).
2. Patch des champs retenus via les setters existants (`updateOwnedAsset`, `updateOwnedAcquisition`, `updateOwnedCredit`, `updateOwnedPostAchat`) — pas de nouvelle API de patch global, réutilisation telle quelle des fonctions à fusion superficielle déjà en place.
3. Pour chaque ligne "Travaux détectés" cochée : upload du justificatif (`uploadOwnedDocument`) puis `addOwnedTravail`.
4. Re-render des onglets concernés (Acquisition, Exploitation, Travaux, Synthèse, Calcul).

## Gestion des erreurs

- Échec réseau/Mammouth sur un document précis → n'affecte que ce document (bascule dans le bloc "Non traités"), le reste du dossier continue.
- Rate limit atteint en cours de traitement (30/h dépassé) → arrêt propre des documents restants, message explicite ("limite horaire atteinte, réessayez plus tard"), les documents déjà traités restent exploitables et validables dans le tableau de revue.
- Fichier dépassant 5 Mo après conversion PDF→PNG → marqué non traité avec raison explicite, pas d'envoi à la Cloud Function.

## Hors périmètre

- Pages suivantes d'un PDF multi-pages (seule la première page est rasterisée).
- Sous-dossiers imbriqués au-delà de ce que `webkitdirectory` renvoie nativement (pas de logique de récursion custom au-delà du comportement navigateur par défaut).
- Persistance du rate-limiter au-delà du process Cloud Function courant (reste en mémoire, remise à zéro sur cold start — limite déjà connue et acceptée pour `extraireFraisFacture`).
- Détection/fusion de conflits inter-champs plus fine que la règle "confiance la plus haute gagne" (pas de pondération, pas de moyenne, pas de score composite).

## Tests

- Playwright : stub de `extraireDossierBien` (même principe que le stub `owned-cloud.js` existant) avec un jeu de documents simulés couvrant plusieurs `documentType` et niveaux de confiance ; vérifie la fusion (valeur de la source la plus fiable retenue, provenance affichée), le bloc Travaux détectés, le bloc Non traités, la validation groupée (champs patchés sur le bien, travaux ajoutés, justificatifs attachés), et le cas bien existant (affichage "valeur actuelle" sans écrasement silencieux).
- Test manuel avec un vrai petit dossier de documents (demandé explicitivement par l'utilisateur à la fin du brainstorming) avant de considérer la fonctionnalité livrée.
- Suite `tests/*.mjs` existante : aucune modification attendue (aucune logique dans `calculs.js`).
