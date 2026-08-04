# Import groupé de factures — onglet Travaux

## Contexte

Suite directe de la refonte de l'onglet Travaux (`docs/superpowers/specs/2026-08-04-onglet-travaux-refonte.md`, déployée le 2026-08-04) : le dropzone facture/photo ne gère qu'un fichier à la fois. L'utilisateur a ponctuellement plusieurs factures à ajouter d'un coup (un dossier de factures accumulées) et ne veut pas répéter le cycle dépôt → vérification → "Ajouter" pour chacune séparément.

## Objectif

Permettre de sélectionner/déposer plusieurs fichiers en une fois sur le dropzone existant, faire extraire chacun par l'IA, les revoir tous ensemble, puis les enregistrer en un seul geste — sans dégrader le flux fichier unique déjà en prod.

## Sélection et branchement

Le dropzone existant (`renderOwnedTravauxTab`, `owned-portfolio.js`) reçoit l'attribut `multiple` sur son `<input type="file">`. Le comportement dépend du nombre de fichiers sélectionnés/déposés :

- **1 fichier** : flux actuel inchangé (pré-remplissage inline du formulaire à droite du dropzone, code déjà en prod, non modifié par cette spec).
- **2 fichiers ou plus** : ouverture d'une modale de revue groupée (`_showOwnedModal`, même mécanisme que les modales existantes — Compte de résultat, Simulation travaux). Le formulaire inline reste inutilisé pour ce lot.

## Extraction et modale de revue

À l'ouverture, la modale liste immédiatement une ligne par fichier avec le statut "lecture…", puis se met à jour au fur et à mesure des réponses de `cloudExtraireFraisFacture`. Les extractions sont lancées avec une **concurrence limitée à 3 appels simultanés** (pas de `Promise.all` sans limite) pour éviter de saturer l'API Anthropic ; un indicateur de progression ("4/12 analysées") reste visible pendant le traitement.

Chaque ligne du tableau est éditable (date/description/montant/tag), pré-remplie si l'extraction a réussi. En cas d'échec sur un fichier précis, la ligne reste éditable manuellement avec un badge d'erreur — le fichier reste rattachable comme justificatif même sans extraction réussie, cohérent avec le comportement fichier unique déjà en place. Une case à cocher par ligne (cochée par défaut) permet de retirer un fichier du lot sans fermer la modale.

## Validation et enregistrement

Un bouton "Ajouter les N frais" (N = lignes encore cochées) déclenche l'enregistrement séquentiel : upload de chaque fichier comme justificatif (`uploadOwnedDocument`) puis `addOwnedTravail`, dans l'ordre d'affichage. Toute ligne sans date/description/montant valides au moment de la validation (extraction ratée et jamais corrigée manuellement) est exclue silencieusement de l'enregistrement, comptabilisée dans un message récapitulatif final ("10 frais ajoutés, 2 ignorés — champs manquants"). Après validation, la modale se ferme et l'onglet Travaux se rafraîchit normalement (comportement déjà existant après tout ajout).

## Hors périmètre

- Pas de glisser-déposer d'un dossier entier (icône de dossier, sous-dossiers) — seulement la sélection/dépose de plusieurs fichiers individuels, cohérent avec la réponse de l'utilisateur.
- Pas de changement au flux fichier unique déjà en prod.
- Pas de limite explicite au nombre de fichiers dans un lot (la concurrence limitée à 3 encadre déjà le débit d'appels ; un lot de plusieurs dizaines de fichiers reste juste plus long à traiter, pas bloquant).

## Tests

- Playwright : script qui stub `cloudExtraireFraisFacture` avec des réponses variées (succès, échec) pour un lot simulé (`setInputFiles` avec un tableau de fichiers), vérifie l'ouverture de la modale à partir de 2 fichiers, le pré-remplissage ligne par ligne, le retrait d'une ligne, la validation groupée (nombre de frais ajoutés, justificatifs attachés), et le message récapitulatif en cas de lignes ignorées — sans jamais appeler la vraie API Anthropic.
- Suite `tests/*.mjs` existante : aucune modification attendue (aucune logique dans `calculs.js`).
