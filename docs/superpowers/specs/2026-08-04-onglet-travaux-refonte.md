# Refonte de l'onglet Travaux — extraction IA depuis facture

## Contexte

L'onglet "Frais & justificatifs" (`renderOwnedTravauxTab`, `owned-portfolio.js`) est jugé peu pratique : formulaire à 7 champs sur une seule ligne, liste repliée par année sans recherche, aucun automatisme — tout est saisi à la main alors que l'utilisateur part presque toujours d'une facture/photo/scan existante.

QA Playwright du 2026-08-04 a par ailleurs révélé et corrigé un bug de validation sur ce formulaire (soumission vide acceptée) — voir `project_portfolio_audit` (mémoire). Cette refonte va plus loin : automatiser la saisie plutôt que seulement la sécuriser.

## Objectif

Réduire au minimum la saisie manuelle en extrayant automatiquement date/description/montant/tag depuis une facture (PDF ou photo) déposée par l'utilisateur, sur PC **et** téléphone, tout en gardant le formulaire manuel disponible pour les cas sans justificatif.

## Disposition

La zone d'ajout de l'onglet Travaux devient une rangée à deux colonnes de même poids visuel, au-dessus de la liste par année (qui reste inchangée dans sa structure) :

- **Colonne gauche — "Depuis une facture"** : zone de dépôt (drag & drop + bouton "Choisir un fichier"), accepte PDF/JPG/PNG. Au dépôt d'un fichier : spinner "Lecture de la facture…", puis pré-remplissage automatique de la colonne droite avec un badge "🤖 pré-rempli" sur les champs concernés et un bandeau "Facture : nom_fichier.ext — vérifie avant de valider".
- **Colonne droite — formulaire manuel actuel** (date/description/montant/tag/commentaire/case "financé par le crédit"), logique inchangée. Peut être rempli à la main (comme aujourd'hui) ou pré-rempli par la colonne gauche — dans les deux cas, un seul bouton "Ajouter" déclenche l'enregistrement, jamais d'écriture automatique sans ce clic.

Au-dessus du classeur par année : un champ recherche qui filtre en temps réel sur description/montant (côté client, insensible casse/accents) et déplie automatiquement les années ayant un résultat ; le classeur revient à son état normal (année courante ouverte) quand le champ est vidé.

## Architecture technique — extraction IA

Nouvelle **Cloud Function Firebase** (`functions/`, Node.js, HTTPS callable), appelée de façon identique depuis `index.html` (PC) et `owned.html` (mobile) via le même code partagé `owned-portfolio.js` — une seule implémentation, pas de duplication PC/mobile, pas de nouvelle route Flask.

Prérequis déjà en place : plan Firebase Blaze actif sur le projet `spark-investissement` (confirmé par l'utilisateur).

Flux :

1. Le client encode le fichier choisi en base64 et l'envoie directement à la Cloud Function (pas de passage par Storage à ce stade — rien n'est enregistré tant que l'utilisateur n'a pas validé).
2. La fonction appelle l'API Messages d'Anthropic avec le document en pièce jointe (PDF ou image, supportés nativement par l'API), modèle `claude-sonnet-4-6` (cohérent avec `/api/portfolio-diagnostic` côté Flask), système en français demandant un JSON strict uniquement :
   ```json
   {"date": "YYYY-MM-DD", "description": "...", "montant": 0, "tagSuggestion": "deductible|non-deductible|a-classifier", "confiance": "haute|moyenne|basse"}
   ```
   Le prompt système inclut les règles fiscales françaises de base pour la suggestion de tag : entretien/réparation/amélioration = déductible ; agrandissement/construction/reconstruction = non déductible.
3. La clé API Anthropic est stockée comme secret Firebase (`firebase functions:secrets:set ANTHROPIC_API_KEY`), jamais exposée au client — distincte de `scraper/config.py` (qui reste PC-only, gitignored, utilisé uniquement par le scraper et la route Flask existante).
4. La fonction renvoie le JSON au client, qui pré-remplit le formulaire de droite. Le `<select>` tag est présélectionné sur `tagSuggestion` avec un badge "suggéré par l'IA" ; si `confiance` est "basse", le tag retombe sur "À classifier" plutôt que de deviner à l'aveugle.
5. Au clic "Ajouter" : flux identique à l'existant — `uploadOwnedDocument` (Storage) puis `addOwnedTravail`, avec les valeurs du formulaire (issues de l'IA si non corrigées, ou saisies à la main).

**Gestion d'erreur** : échec d'extraction (PDF illisible, scan flou, panne réseau, timeout) → toast négatif "Extraction impossible, remplis le formulaire à la main", la colonne droite reste utilisable normalement. Aucun cas ne doit bloquer l'ajout manuel.

## Hors périmètre (assumé, pas à réintroduire sans redemander)

- Pas d'auto-enregistrement sans validation utilisateur (chiffres fiscaux, risque d'erreur d'extraction trop élevé pour sauter la relecture).
- Pas d'extraction IA dans la modale d'édition d'un frais existant (`openEditTravailModal`) — reste manuelle, seul le flux d'ajout est concerné par cette refonte.
- Pas de bascule du classeur par année vers une table plate — gardé tel quel (utile pour le total déductible par an), seule une recherche est ajoutée par-dessus.

## Tests

- Pas de nouvelle logique dans `calculs.js` — si un helper de normalisation de la réponse IA est ajouté côté client, il sera testé isolément avec `node:assert`.
- Playwright : script dédié qui stub la Cloud Function (même technique que le stub `owned-cloud.js` déjà en place) pour vérifier : pré-remplissage après dépôt de fichier, correction manuelle des champs pré-remplis, cas d'échec (réseau/extraction), et le filtre de recherche — sans jamais appeler la vraie API Anthropic pendant les tests automatisés.
- Test manuel avec une facture réelle (utilisateur) avant de considérer la fonctionnalité définitivement validée — la qualité d'extraction dépend du document réel, pas simulable en amont.
