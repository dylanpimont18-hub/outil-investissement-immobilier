# Spec — Refonte Scanner
Date : 2026-06-09

## Contexte

Application desktop Spark Investissement (Flask + PyWebView). Le scanner scrape LeBonCoin pour trouver des biens immobiliers, enrichit avec l'IA Anthropic, et affiche les résultats dans un tableau filtrable.

**Objectif :** Focaliser le scanner sur Vierzon (18100) avec rayon configurable, améliorer l'efficacité du pipeline de scraping/enrichissement, améliorer l'ergonomie/UX du panneau Scanner, et unifier son design avec les panneaux Analyse et Portefeuille.

---

## Groupe A — Zone & Rayon

### A — Zone pré-remplie au démarrage
- Au chargement du scanner, pré-sélectionner Vierzon 18100 comme zone de scan (ou la dernière zone utilisée, persistée en localStorage)
- Fichiers : `scanner.js` → `_initScanTargetSelector()`, appeler `_setScanTarget('18100', 'Vierzon', 'Vierzon — 18100')` si aucune zone en localStorage

### B — Rayon sélectionnable (mécanique principale)
**Config :**
- `scraper/config.py` : réduire `VILLES` à uniquement `{"ville": "Vierzon", "code_postal": "18100", "dept": "18"}` (supprimer les 12 autres villes)

**UI (scanner.js + index.html) :**
- Dans la card "Cibler une zone", ajouter sous le champ CP un sélecteur de rayon : boutons radio 5 / 10 / 20 / 30 km, défaut **5 km**, persisté en localStorage sous la clé `scannerRayonKm`
- À l'envoi du scan : inclure `rayon_km` dans le body JSON → `{ code_postal, ville, rayon_km }`

**API (server.py) :**
- `api_scan()` et `api_scan_full()` : extraire `rayon_km` du JSON, le passer à `_run_scanner(full, ville, code_postal, rayon_km)`
- `_run_scanner` : injecter `rayon_km` dans `villes_override` : `{"ville": ..., "code_postal": ..., "dept": ..., "rayon_km": rayon_km}`

**Scraper (scraper/scrapers/leboncoin.py) :**
- `fetch_ville(ville)` : si `ville.get("rayon_km")`, construire l'URL avec rayon en mètres : `locations={code_postal}__{rayon_km * 1000}` au lieu de `locations={code_postal}`

**Filtre base (scraper/scrapers/base.py) :**
- Dans `fetch_all()`, le filtre `if cp_annonce and cp_annonce != cp_cible: continue` doit être désactivé quand `ville.get("rayon_km")` est défini (un rayon retourne des CP variés)

### C — Badge commune + distance dans le tableau
- Chaque ligne du tableau affiche la commune réelle (déjà dans `r.ville`) + badge coloré par distance estimée au centroïde 18100
  - Distance calculée côté JS à partir des coords de la commune (table `geocodes` en DB ou fallback bbox statique)
  - Vert < 10 km, orange 10–20 km, rouge > 20 km
- Ajouter colonne "Commune" dans le tableau (remplace ou enrichit la cellule "Bien")

### D — Filtre distance dans la sidebar
- Slider "Distance max" (km) dans `#scanner-filters` → filtre côté JS sur les résultats déjà chargés, sans relancer le scan
- Stocker la distance sur chaque bien dans les résultats JSON (calculé côté server.py ou JS)

### E — Carte centrée Vierzon avec cercle de rayon
- L'onglet Carte (`tab-carte`) s'ouvre centré sur Vierzon (lat: 47.222, lng: 2.069)
- Dessiner un cercle `L.circle` avec le rayon actif en km
- Mettre à jour le cercle quand le rayon change

---

## Groupe F — Efficacité pipeline

### G — Descriptions parallèles (3× plus rapide)
**Fichier :** `scraper/main.py` → `_hydrate_descriptions()`
- Remplacer la boucle séquentielle par `concurrent.futures.ThreadPoolExecutor(max_workers=3)`
- Conserver le `time.sleep(1)` de politesse entre workers (via `rate_limiter` ou simple semaphore)
- Supprimer le `time.sleep(4)` actuel entre chaque description

### H — Badge "Baisse de prix" dans le tableau
**Backend :** `server.py` → `_query_results_data()`
- Ajouter une jointure sur `historique_prix` : `SELECT MAX(hp.prix_ancien) - b.prix AS baisse, MAX(hp.date_changement) AS date_baisse FROM historique_prix hp WHERE hp.bien_id = b.id`
- Inclure `baisse` et `date_baisse` dans le JSON résultats

**Frontend :** `scanner.js` → `_buildScannerSummaryRow()` et template de ligne
- Si `r.baisse > 0` : afficher badge `↓ -X €` rouge sur la cellule Prix, avec tooltip montrant l'ancienne valeur et la date

### I — Top 5 en tête de résultats
**Fichier :** `scanner.js` → `_renderGlobalOverviewTable()`
- Avant le tableau principal, rendre les 5 premiers rows (par score DESC) comme cartes `.scanner-curation-card`
- Afficher : rang, titre, prix, CF après impôt, score, décision, résumé IA
- Les cartes sont déjà définies dans le CSS (`.scanner-curation-card`, `.scanner-curation__grid`)

### J — Préfiltrage pré-IA
**Fichier :** `scraper/enrich.py` → `enrich_pending()`
- Avant d'envoyer au batch Anthropic, exclure les biens sans description ET sans surface ET sans type_bien (aucune donnée exploitable pour l'IA)
- Ces biens restent en DB mais repassent à l'enrichissement au prochain cycle (ne pas les marquer comme enrichis)
- Logger le nombre d'annonces filtrées

### K — Indicateur de fraîcheur
**Backend :** déjà disponible → `b.date_derniere_vue` dans les résultats JSON

**Frontend :** `scanner.js`
- Sur chaque ligne, afficher "Vu il y a X j" ou "Vu aujourd'hui" sous le titre (petite ligne muted)
- Si `date_derniere_vue` > 10 jours : classe `--stale` (texte orange) → signal que le bien est peut-être vendu

---

## Groupe L — Ergonomie / UX

### L1 — Tableau réduit à 8 colonnes
Colonnes actuelles (13) : Classement, Bien, Statut, Décision, Prix, Loyer, CF après impôt, Renta N/N, DSCR, Score, Régime, DPE, Signaux

Colonnes cibles (8) :
1. **Rang** (inchangé)
2. **Bien** — titre + sous-titre + statut IA (badge inline) + signaux (badges inline) + fraîcheur (ligne muted)
3. **Prix** — prix + badge baisse si applicable
4. **Loyer estimé** (inchangé)
5. **CF fiscal** (CF après impôt, inchangé)
6. **Renta N/N** (inchangé)
7. **DPE** — badge coloré (voir L3)
8. **Score / Décision** — score sur 100 + pill décision

Supprimer : Statut (→ badge sur Bien), Signaux (→ badges sur Bien), Régime (→ fiche détail), DSCR (→ fiche détail)

### L2 — Header simplifié + titre dynamique
- Supprimer le texte story `<p class="scanner-header-story">…</p>` dans `index.html`
- Rendre le sous-titre `#scanner-header-sub` dynamique : `"Vierzon 18100 · 20 km · 23 biens"` mis à jour après chaque chargement de résultats
- Mettre à jour le chip `"Lot régional"` → chip dynamique avec la zone active

### L3 — DPE coloré dans le tableau
- Remplacer le texte "DPE F" par un badge coloré utilisant les mêmes classes que les filtres DPE : `.scanner-chip--dpe-a/b/c/d/e/f/g`
- Si DPE non renseigné : `"—"` en muted

### L4 — Bouton "Scan complet" dans menu options
- Dans `index.html`, retirer `btn-scan-full` de la rangée principale des actions
- Ajouter un bouton `⋯` (icône `•••`) à côté de "Lancer un scan" qui ouvre un petit dropdown avec "Scan complet (vide cache)" et "Options avancées"

### L5 — Stats row : chiffre principal mis en avant
- Dans `scanner.js` → `_renderScannerStats()` (ou équivalent), inverser la hiérarchie visuelle : **chiffre** en `font-size: 1.5rem`, `font-weight: 700`, label en `font-size: 0.72rem` dessous
- Appliquer les couleurs de statut : CF positif → vert, score moyen → or, biens DPE risque → orange

### L6 — Filtres accordéon : hover sur section-title
- Dans `styles.css` : `.scanner-filter-section-title:hover { background: var(--surface-hover); border-radius: var(--radius-sm); }`
- Ajouter `cursor: pointer` et `padding: 6px 8px` sur `.scanner-filter-section-title` pour une cible de clic élargie

---

## Groupe M — Unification design Analyse/Portefeuille

### M1 — Header Scanner → workspace-hero-card
- Remplacer `.scanner-header` / `.scanner-command-grid` dans `index.html` par la structure `workspace-hero-card` :
  ```html
  <div class="workspace-hero">
    <div class="workspace-hero-card">
      <div class="workspace-hero-copy"><!-- titre, kicker, meta --></div>
      <div class="workspace-hero-score"><!-- card d'action scan --></div>
    </div>
  </div>
  ```
- Conserver le contenu (zone, rayon, boutons) en l'adaptant à la structure hero
- Corriger le gradient hardcodé `rgba(59, 130, 246)` → `var(--primary)` dans `styles.css`

### M2 — Boutons → classes globales
- Remplacer `scanner-btn--primary` → classe globale `.btn--primary` (ou mapper dans CSS)
- Remplacer `scanner-btn--outline` → `.btn--outline`
- Conserver `scanner-btn--accent` (spécifique IA) uniquement si aucun équivalent global

### M3 — Stats row → workspace-hero-mini-card
- Remplacer `.scanner-stat` par `.workspace-hero-mini-card` (déjà dans styles.css) pour les stats post-scan
- Adapter le contenu `scanner-stat-val` / `scanner-stat-lbl` aux slots `span` / `strong` du mini-card

### M4 — Typography tokens
- `.scanner-command-card__title` : aligner sur `workspace-hero-copy h2` → `clamp(1.4rem, 2vw, 1.8rem)`, `letter-spacing: -0.02em`
- `.scanner-command-card__eyebrow` : aligner sur `.workspace-hero-kicker` → `font-family: var(--font-mono)`, `font-size: 0.72rem`, `text-transform: uppercase`, `color: var(--primary)`

### M5 — Progress bar → card standard
- Envelopper `#scanner-progress` dans un `.workspace-hero-card` simplifié (sans le score panel droit)
- Appliquer `border-radius: 18px`, `padding: 20px`, fond dégradé cohérent

### M6 — Empty state → cohérence visuelle
- `.scanner-empty` : aligner le style sur les empty states des autres panneaux (même centrage, même typographie, même bouton CTA)

---

## Fichiers impactés

| Fichier | Modifications |
|---|---|
| `scraper/config.py` | VILLES réduit à Vierzon 18100 uniquement |
| `scraper/scrapers/leboncoin.py` | URL avec rayon optionnel |
| `scraper/scrapers/base.py` | Désactiver filtre CP si rayon défini |
| `scraper/main.py` | `_hydrate_descriptions` parallèle (G) |
| `scraper/enrich.py` | Préfiltrage pré-IA (J) |
| `server.py` | Passer `rayon_km`, jointure `historique_prix` (H), distance dans résultats |
| `index.html` | Nouveau header hero, sélecteur rayon, menu `⋯`, suppression story text |
| `scanner.js` | Zone pré-remplie, rayon, tableau 8 col, Top 5, badges baisse/fraîcheur/DPE, stats |
| `styles.css` | Corrections gradient, mini-cards, filter hover, DPE badges, empty state |
