# Spec — Sélection de code postal obligatoire avant le scan

**Date :** 2026-05-28  
**Statut :** Approuvé

## Contexte

Le scanner actuel lance le scraper sur l'intégralité de la liste `VILLES` configurée dans `config.py` (toutes les villes de Centre-Val de Loire). Le champ `cp-search` dans la barre de recherche ne fait que filtrer les résultats affichés — il n'influence pas ce qui est scanné.

L'objectif est de forcer l'utilisateur à choisir un code postal **avant** de lancer le scan, afin que le scraper ne cherche que les annonces de cette ville spécifique.

## Comportement attendu

1. L'utilisateur ouvre l'onglet Scanner.
2. Un champ CP avec autocomplétion apparaît dans le header (header-left), sous le titre.
3. Les boutons "Lancer un scan" et "Scan complet" sont désactivés tant qu'aucun CP/ville n'est sélectionné.
4. L'utilisateur saisit un CP ou un nom de commune → dropdown d'autocomplétion → sélection.
5. Un badge confirme la sélection (ex : `18000 — Bourges`). Les boutons scan s'activent.
6. L'utilisateur clique "Lancer un scan" → le CP et la ville sont envoyés dans le body POST.
7. Le scraper ne traite que cette ville (liste `villes` réduite à une entrée).
8. Quand le scan se termine avec succès, le filtre CP de la barre de recherche est auto-rempli avec ce même CP.
9. L'utilisateur peut réinitialiser le CP via "× Réinit." → les boutons scan se désactivent à nouveau.

## Changements par fichier

### `index.html`

- Dans `.scanner-header-left`, ajouter sous `<p id="scanner-header-sub">` :
  - Un groupe input CP : `#scan-target-cp-input` (autocomplétion), `#scan-target-cp-dropdown`, `#scan-target-cp-badge`, `#scan-target-cp-reset`
- Ajouter `disabled` aux boutons `#btn-scan` et `#btn-scan-full` par défaut.

### `scanner.js`

- Nouvelle variable d'état : `_scanTarget = null` → `{ cp: string, commune: string|null, label: string }`
- Nouvelle fonction `_initScanTargetSelector()` : autocomplétion sur `communes_centre_val.json`, même logique que `_initCPSelector()`, branchée sur `#scan-target-cp-input`.
- Nouvelle fonction `_setScanTarget(cp, commune, label)` : met à jour `_scanTarget`, affiche le badge, active les boutons scan.
- Nouvelle fonction `_resetScanTarget()` : efface `_scanTarget`, masque le badge, désactive les boutons scan.
- Remplacer les appels `_setButtonsDisabled(disabled)` par une logique centralisée : boutons désactivés si `_scanTarget === null` OU si scan en cours.
- Modifier `_startScan(endpoint)` : inclure `{ code_postal: _scanTarget.cp, ville: _scanTarget.commune }` dans le body JSON du POST.
- À la fin de `_pollStatus()` (quand le scan se termine sans erreur) : appeler `_setCPFilter(_scanTarget.cp, _scanTarget.commune, _scanTarget.label)` pour pré-remplir le filtre résultats.
- Appeler `_initScanTargetSelector()` depuis `_bindButtons()`.

### `server.py`

- Modifier `api_scan()` et `api_scan_full()` :
  - Lire `ville` et `code_postal` du body JSON (`request.get_json()`).
  - Si l'un ou l'autre est absent ou vide → retourner 400 `{"error": "ville_required"}`.
  - Passer ces valeurs à `_run_scanner(full, ville, code_postal)`.
- Modifier `_run_scanner(full, ville=None, code_postal=None)` :
  - Construire `villes_override = [{"ville": ville, "code_postal": code_postal, "dept": code_postal[:2]}]`
  - Passer à `scraper_main.main(villes_override=villes_override, progress_callback=progress_callback)`.

### `scraper/main.py`

- Modifier `main(progress_callback=None, villes_override=None)` :
  - Si `villes_override` est fourni et non vide → utiliser à la place de `VILLES` importé depuis `config`.
  - Aucun autre changement.

## Ce qui ne change pas

- Le `cp-search` de la barre de recherche post-scan reste identique (filtre d'affichage uniquement).
- Le scan full vide la DB comme aujourd'hui (inchangé).
- L'enrichissement IA, les calculs financiers, le stockage SQLite : aucun changement.
- Les scrapers individuels : aucun changement (ils reçoivent déjà une liste de villes).

## Cas limites

- Si l'utilisateur efface la sélection CP pendant qu'un scan est en cours : `#scan-target-cp-input` et `#scan-target-cp-reset` sont désactivés (disabled/pointer-events:none) pendant toute la durée du scan, via la même fonction de verrouillage que les boutons scan. L'utilisateur ne peut pas changer la cible en cours de scan.
- Si la ville saisie n'est pas dans `communes_centre_val.json` mais que l'utilisateur entre un CP manuellement : non supporté — l'autocomplétion est obligatoire pour garantir le format `{ ville, code_postal }`.
- `_scanTarget` est un état session (non persisté en `localStorage`) : à chaque rechargement, le CP doit être resaisi.
