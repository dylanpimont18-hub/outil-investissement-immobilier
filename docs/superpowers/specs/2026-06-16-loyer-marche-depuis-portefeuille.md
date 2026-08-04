# Spec — Loyer marché on-demand depuis le Portefeuille

**Date :** 2026-06-16  
**Périmètre :** Portefeuille biens détenus — bouton "📈 Loyer marché"

---

## Contexte

Le bouton "📈 Loyer marché" dans la Synthèse d'un bien détenu appelle `POST /api/loyer-marche`. Si la table `loyers_marche` est vide ou n'a pas encore de données pour la ville du bien, l'API retourne 404. Aujourd'hui l'utilisateur doit aller dans le Scanner pour déclencher un scan complet qui, en passant, peuple `loyers_marche`. L'objectif est de permettre de récupérer les données de marché locatif directement depuis le portefeuille, pour une ville donnée, sans passer par le Scanner.

---

## Changements

### 1. Modèle de données owned asset

Ajout de `codePostal: ''` au niveau racine de l'objet owned asset (comme `ville`), dans `createOwnedAsset` dans `main.js`.

Structure résultante :
```js
{
  id, nom, ville, codePostal, anneeAchat,
  acquisition: { ..., surface, typeBien, ... },
  postAchat: { ... },
  scenarios: [...],
  lastDiagnostic: null
}
```

### 2. Formulaire Acquisition

Dans `renderAccordionAcquisition` : ajout d'un champ "Code postal" à côté de "Ville", géré par `data-owned-field="codePostal"` (le handler `change` existant écrit déjà les champs top-level via `data-owned-field`).

### 3. Endpoint `/api/loyer-marche/refresh`

**Route :** `POST /api/loyer-marche/refresh`  
**Body :** `{ ville: str, code_postal: str, type_bien: str }`  
**Comportement :**
1. Valide que `ville` et `code_postal` sont présents — sinon 400
2. Appelle `marche_locatif.main(conn, villes=[{ville, code_postal}])` de façon **synchrone**
3. Retourne `{ ok: true }` si succès, `{ error: "..." }` si exception

**Durée attendue :** 15-30 s pour une ville (quelques pages LeBonCoin + `time.sleep(4)` entre pages).  
Flask est en `threaded=True` — les autres requêtes ne sont pas bloquées.

### 4. Machine d'états du bouton (frontend)

Le bouton "📈 Loyer marché" dans `renderOwnedSynthese` passe par les états suivants :

```
État A : [📈 Loyer marché]
  → click : POST /api/loyer-marche
    → 200 : affiche résultat, état A (inchangé)
    → 404 : passe à l'état B

État B : [📡 Récupérer pour <ville>]
  → click :
    - si codePostal vide → toast "Renseignez le code postal dans Acquisition", reste état B
    - sinon → passe à l'état C : POST /api/loyer-marche/refresh

État C : [⏳ Récupération…] (bouton désactivé)
  → réponse ok  : retry POST /api/loyer-marche
    → 200 : affiche résultat, état A
    → 404 : toast "Aucune annonce de location trouvée pour <ville>", état B
  → réponse err : toast "Erreur lors de la récupération : <message>", état B
```

L'état B/C est **local à la session** (pas persisté en localStorage) — si l'utilisateur recharge, le bouton retente directement `/api/loyer-marche` et retrouve les données si le refresh a réussi.

---

## Périmètre exclu

- Pas de progress bar ni de polling pendant la récupération (le bouton ⏳ suffit)
- Pas de TTL / force-refresh si des données existent déjà (un 200 ne passe pas par le refresh)
- Pas de scan des annonces de vente depuis le portefeuille

---

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `main.js` | `createOwnedAsset` + `renderAccordionAcquisition` + logique bouton dans le click handler |
| `server.py` | Nouvel endpoint `POST /api/loyer-marche/refresh` |
| `CODEBASE_MAP.md` | Mise à jour entrées `main.js` et `server.py` |
