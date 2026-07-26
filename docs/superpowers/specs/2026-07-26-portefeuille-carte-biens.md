# Spec — Carte des biens détenus (portefeuille)

Date : 2026-07-26
Statut : validé (conversation), en attente de relecture du fichier

## Contexte

Le portefeuille de biens détenus (`owned-portfolio.js`) n'a aujourd'hui que `ville`/`codePostal`
par bien, pas d'adresse complète. L'utilisateur veut une carte affichant tous ses biens détenus,
zoomée pour tous les voir d'un coup d'œil, ce qui nécessite une adresse précise (pas juste une
ville) pour un placement fiable des marqueurs.

En explorant le code existant, deux constats connexes :
- Le Scanner (`scanner.js`) a déjà une carte Leaflet fonctionnelle dans son principe, mais elle
  appelle `POST /api/geocode/batch`, une route supprimée de `server.py` le 2026-06-07
  (commit `665d4d5`, message "supprimer routes géocodage mortes — jamais appelées depuis le
  frontend" — en réalité si, elle l'est). Résultat : la carte Scanner affiche actuellement tous
  les biens comme "non localisés".
- `vendor/leaflet/` est déjà vendorisé et chargé côté client — aucune nouvelle dépendance requise.

## Décisions validées avec l'utilisateur

1. Emplacement : nouvelle section carte dans la vue liste du portefeuille (`#owned-list-view`),
   visible en permanence (pas un accordéon replié, pas une modale).
2. On répare aussi la carte Scanner en recréant l'endpoint batch (effort marginal, même route).
3. Géocodage déclenché automatiquement à la sauvegarde de l'adresse (pas de bouton manuel).
4. Champ adresse dans l'accordéon Acquisition, à côté de Ville/Code postal existants.
5. Marqueur = nom du bien + CF net-net + couleur verte/rouge selon le signe du CF, popup avec
   bouton vers la fiche détaillée.

## Backend

### Nouvelle table (`scraper/db.py`)

```sql
CREATE TABLE IF NOT EXISTS geocodes_adresse (
    adresse TEXT PRIMARY KEY,
    lat     REAL,
    lng     REAL
);
```

Distincte de la table `geocodes` existante (clé `ville`+`code_postal`, utilisée par le Scanner) :
granularité différente, clé différente.

### `POST /api/geocode/address` (nouveau, `server.py`)

- Entrée : `{adresse: string}`.
- Vérifie le cache `geocodes_adresse` (clé = adresse trimée).
- Si absent : appelle Nominatim (`https://nominatim.openstreetmap.org/search?q=<adresse>&format=json&limit=1`)
  avec un header `User-Agent` explicite (obligatoire côté Nominatim).
- Stocke le résultat en cache (y compris `lat: null` si introuvable, pour éviter de re-taper
  l'API à chaque frappe sur une adresse invalide).
- Retourne `{lat, lng}` ou `{lat: null, lng: null}`.

### `POST /api/geocode/batch` (recréé, `server.py`)

- Entrée : liste `[{ville, code_postal}, ...]`.
- Réutilise la table `geocodes` existante (déjà en place, jamais droppée).
- Géocode les entrées non cachées séquentiellement avec un délai de 1,1 s entre appels Nominatim
  (politique d'usage de l'API publique : 1 req/s max).
- Retourne un dict `{"ville|code_postal": {lat, lng}, ...}` — même format que `scanner.js` attend
  déjà (`geoData[key]` avec `key = \`${r.ville}|${r.code_postal}\``), donc aucun changement côté
  `scanner.js` pour cette partie.

## Modèle de données (`owned-portfolio.js`)

Nouveaux champs top-level sur l'objet bien (même niveau que `ville`/`codePostal`) :
- `adresse` (string, vide par défaut)
- `lat` / `lng` (number | null, absent tant que non géocodé)

## Frontend — saisie et géocodage

- Champ `<input data-owned-field="adresse">` ajouté dans `renderAccordionAcquisition`, juste après
  le champ Code postal.
- Le listener `change` existant sur `#acc-acquisition-content` (déjà présent, gère `data-owned-field`)
  est étendu : quand le champ modifié est `adresse` et que sa valeur est non vide, on déclenche un
  appel asynchrone `POST /api/geocode/address` après la sauvegarde locale. Au retour, on patch
  `lat`/`lng` sur le bien via `updateOwnedAsset` et on rafraîchit la carte si elle est déjà montée.
- Pendant l'appel, un indicateur texte discret sous le champ ("Localisation en cours…"), puis soit
  disparaît (succès) soit affiche "Adresse non localisée — vérifiez l'orthographe" (échec).
- Si l'adresse est vidée, `lat`/`lng` sont remis à `null` (pas d'appel réseau).

## Frontend — carte

- `index.html` : nouvelle section `#owned-map-section` dans `#owned-list-view`, sous
  `#owned-kpi-banner` et avant le tableau des biens. Markup calqué sur `.scanner-map-shell` /
  `.scanner-map-canvas` (réutilise les mêmes classes CSS existantes, pas de nouveau style requis
  au-delà d'un `#owned-map` dédié).
- `owned-portfolio.js` : nouvelle fonction `renderOwnedMap(list)`, appelée à la fin de
  `renderOwnedPortfolioList()` :
  - Lazy-init Leaflet (pattern identique à `_initMap()` du Scanner : un seul `L.map(...)` créé une
    fois, réutilisé ensuite).
  - Un `L.circleMarker` par bien avec `lat`/`lng` renseignés : vert (`--success`) si le CF net-net
    du scénario par défaut est ≥ 0, rouge (`--danger`) sinon.
  - Popup : nom du bien, ville, CF net-net formaté, bouton "Voir le détail" → `openOwnedDetail(id)`.
  - `fitBounds` sur l'ensemble des marqueurs après chaque rendu (recentre/zoome automatiquement).
  - Si aucun bien n'a de coordonnées : message "Ajoutez une adresse à vos biens pour les voir sur
    la carte" à la place de la carte.
  - Si certains biens seulement manquent de coordonnées : note sous la carte, ex.
    "2 biens non localisés — ajoutez leur adresse dans l'onglet Acquisition."
  - Section masquée si le portefeuille est vide (même garde que le reste de
    `renderOwnedPortfolioList`).

## Hors périmètre

- Pas de géocodage inverse (adresse → carte cliquable pour remplir le champ).
- Pas de drag & drop du marqueur pour ajuster manuellement lat/lng.
- Pas de clustering de marqueurs (nombre de biens détenus attendu faible, contrairement au Scanner).

## Tests

- Test Python pour `POST /api/geocode/address` : cache hit, cache miss (Nominatim mocké), adresse
  introuvable (retourne `lat: null` sans planter).
- Vérification manuelle dans l'app : ajouter une adresse réelle à un bien existant, confirmer que
  le marqueur apparaît au bon endroit et que le popup affiche le bon CF.
