# Cahier des charges — Refonte section Portefeuille

**Date :** 2026-06-08
**Statut :** Approuvé

---

## Contexte et objectif

La section Portefeuille actuelle présente trop d'informations sans hiérarchie claire. L'utilisateur ne sait pas quoi regarder en priorité. L'objectif de cette refonte est de réorienter la section autour d'une seule question : **"Dois-je faire quelque chose sur ce bien ?"**

Le portefeuille doit fonctionner comme un copilote de décision : synthèse visuelle immédiate, signaux actionnables, outils de suivi (travaux, notes), conseils fiscaux intelligents, et diagnostic IA à la demande.

---

## Périmètre

### Inclus
- Refonte complète de la section Portefeuille (`collection-panel` dans `index.html`)
- Donuts cash-flow : un par bien détenu + un consolidé
- Conseils intelligents basés sur règles métier
- Fiches de biens avec sections Travaux et Notes
- Diagnostic IA à la demande via Claude API (nouveau endpoint Flask)
- Suppression de la section "Projection patrimoniale"

### Exclu
- Section Analyse individuelle (inchangée)
- `calculs.js` — aucune modification du moteur financier
- Scanner
- Génération PDF
- Section Faisabilité

---

## Architecture technique

### Stockage des données nouvelles

Les travaux et notes sont stockés dans `localStorage`, sous la clé `investissementWebAssetMeta`, structuré comme suit :

```json
{
  "<assetId>": {
    "travaux": [
      {
        "id": "uuid",
        "date": "2026-03-15",
        "description": "Remplacement chaudière",
        "montant": 1200,
        "tag": "deductible" // "deductible" | "non-deductible" | "a-classifier"
      }
    ],
    "notes": [
      {
        "id": "uuid",
        "createdAt": "2026-06-08T10:30:00",
        "text": "Toiture à surveiller, devis en cours"
      }
    ],
    "lastDiagnostic": {
      "date": "2026-06-08T10:30:00",
      "recommendations": []
    }
  }
}
```

### Nouveau endpoint Flask

`POST /api/portfolio-diagnostic`

Reçoit : payload JSON avec toutes les données du portefeuille (biens, profil fiscal, travaux, notes).
Retourne : `{ recommendations: [...], generatedAt: "..." }`

Appel synchrone Claude API (`claude-sonnet-4-6`) avec prompt structuré. Timeout : 30 secondes. En cas d'erreur, le frontend affiche un message d'erreur non bloquant.

### Fichiers modifiés
- `index.html` — restructuration du `collection-panel`
- `main.js` — nouvelles fonctions de rendu portefeuille, gestion travaux/notes, appel diagnostic
- `styles.css` — nouveaux composants visuels (fiches, donuts, conseils, formulaire travaux)
- `server.py` — ajout endpoint `/api/portfolio-diagnostic`
- `calculs.js` — **aucune modification**

---

## Zone 1 — Tableau de bord global

### Bandeau KPI (conservé, nettoyé)
6 cartes KPI existantes conservées sans modification :
- CF net-net consolidé / mois
- Rendement brut moyen
- Patrimoine investi total
- DSCR moyen
- Loyers bruts encaissés / mois
- Capacité d'emprunt restante estimée

### Donut cash-flow consolidé (nouveau)
Camembert Chart.js agrégant tous les biens en statut `owned`. Quatre segments :
- **Banque** — total mensualités crédit
- **Charges** — total charges mensuelles (gestion, assurance, taxe foncière, autres)
- **Impôts** — total impôts mensualisés selon régime de chaque bien
- **CF net-net** — résidu (peut être négatif → segment affiché en rouge)

Survol d'un segment : affiche le montant mensuel en euros et le pourcentage.

Si aucun bien détenu : le donut est masqué.

### Alertes actives (nouveau)
1 à 3 pastilles générées depuis le moteur de règles (voir Zone 2). Chaque pastille :
- Icône + texte court (max 80 caractères)
- Couleur selon sévérité : orange (à surveiller) ou rouge (action recommandée)
- Cliquable → scroll vers le bien ou le conseil concerné

---

## Zone 2 — Conseils intelligents

Bloc titré "Ce que tu devrais regarder". Visible uniquement si au moins un bien est enregistré.

### Calculs préalables aux règles

- **Revenus fonciers annuels estimés** = `sum(loyer * 12 * (1 - vacance/100))` sur tous les biens `owned`
- **Taux d'endettement** = `sum(mensualite_credit) / (revenu_foyer / 12) * 100`
- **Intérêts annuels d'un bien** = calculés via `capitalRestantDu()` si le champ "Année d'achat" est renseigné ; sinon champ omis du payload IA et règles temporelles ignorées pour ce bien

### Nouveau champ de formulaire requis

Ajouter au formulaire un champ optionnel **"Année d'achat"** (`annee-achat`, entier, ex : 2022). Il permet de calculer :
- la durée de détention en mois (`(annee_courante - annee_achat) * 12`)
- les intérêts restants sur la durée écoulée (via `capitalRestantDu`)

Ce champ suit les mêmes conventions que les autres champs : entrée dans `VARIABLE_DEFAULTS` (valeur `null`), `VARIABLE_KEYS`, `sanitizeVariablesData()`, et `<fieldset>` dans `index.html`. Si absent, les conseils temporels et le champ `duree_detention_mois` sont simplement omis.

### Règles métier (évaluées à chaque render)

**Fiscalité**

| Condition | Conseil |
|---|---|
| Revenus fonciers annuels estimés > 15 000 € ET régime = micro-foncier | "Vos revenus fonciers dépassent le seuil — le régime réel est probablement plus avantageux" |
| TMI ≥ 30 % ET CF net-net consolidé > 0 ET ≥ 2 biens détenus | "Votre TMI et votre CF positif rendent la SCI-IS pertinente à étudier" |
| Total travaux déductibles annuels d'un bien > 1 500 € ET régime = micro-foncier | "Les travaux déductibles de [bien] justifient d'évaluer le passage en régime réel" |
| Intérêts restants sur prêt > 2 000 €/an ET régime = micro-foncier | "Les intérêts d'emprunt de [bien] sont encore significatifs — déductibles en régime réel" |

**Dette & financement**

| Condition | Conseil |
|---|---|
| Taux d'endettement > 30 % | "Taux d'endettement à [X]% — approche du seuil bancaire de 35%" |
| Taux d'endettement < 25 % ET capacité > 50 000 € | "Capacité d'emprunt disponible estimée à [X] k€" |

**Risque**

| Condition | Conseil |
|---|---|
| DSCR d'un bien < 1.1 | "DSCR de [bien] à [X] — faible marge en cas de vacance" |
| CF net-net d'un bien < -100 €/mois | "[bien] est en CF négatif ([X] €/mois) — il pèse sur le consolidé" |
| Tous les biens dans la même ville | "Concentration géographique — tous vos biens sont à [ville]" |

**Travaux**

| Condition | Conseil |
|---|---|
| ≥ 1 travail avec tag `a-classifier` | "Des travaux non classifiés attendent une décision fiscale" |

Chaque carte de conseil expose :
- Titre court
- Explication 2-3 lignes
- Action : `"Charger dans le simulateur"` | `"Voir la fiche"` | aucune action

---

## Zone 3 — Fiches de biens détenus

Grille 2 colonnes (desktop) / 1 colonne (mobile). Un composant par bien en statut `owned`.

### En-tête de fiche
- Nom du bien + ville
- Régime fiscal actuel (badge : `micro-foncier` / `réel` / `sci-is`)
- Badge verdict :
  - **RAS** (vert) — aucun conseil de Zone 2 ne concerne ce bien
  - **À surveiller** (orange) — au moins un conseil de sévérité orange concerne ce bien
  - **Action recommandée** (rouge) — au moins un conseil de sévérité rouge concerne ce bien

### Corps de fiche

**Donut cash-flow** (Chart.js, même logique que le consolidé, données isolées à ce bien). Taille : 160×160 px. Légende à droite avec montants mensuels.

**3 KPIs en ligne** sous le donut :
- Rendement brut (%)
- CF net-net (€/mois)
- DSCR

### Section dépliable "Travaux"

Déployée par défaut si tag `a-classifier` présent, repliée sinon.

Liste chronologique (plus récent en haut). Chaque entrée :
- Date | Description | Montant | Tag fiscal (badge coloré)

Tags :
- `deductible` → badge vert "Déductible réel"
- `non-deductible` → badge gris "Non déductible"
- `a-classifier` → badge orange "À classifier"

Pied de section :
- Total déductible annuel (somme des entrées `deductible` de l'année courante)
- Total non déductible annuel

Bouton **"+ Ajouter un travail"** : ouvre un formulaire inline avec les champs date, description, montant (€), tag fiscal (select). Validation : date et montant obligatoires. Sauvegarde dans `localStorage`.

### Section dépliable "Notes"

Repliée par défaut. Chaque bloc de note : texte + date de création (grisée, petite). Ajout via zone de texte en bas de section + bouton "Enregistrer". Les notes s'ajoutent en bas (ordre chronologique).

### Bouton principal
**"Charger dans le simulateur"** — recharge ce bien dans l'onglet Analyse.

---

## Zone 4 — Pipeline (biens à l'étude)

Tableau comparatif des biens en statut `candidate`. Colonnes :
- Nom | Ville | Prix | Rendement brut | CF estimé | DSCR | Score | Action

Triable par toutes les colonnes numériques. Bouton "Charger" par ligne.

Si aucun bien en pipeline : section masquée.

---

## Zone 5 — Diagnostic IA

### Déclenchement
Bouton **"Diagnostic IA ✦"** en haut à droite de la section, toujours visible. Désactivé si aucun bien enregistré.

Au clic : état de chargement (spinner + "Analyse en cours…"), appel `POST /api/portfolio-diagnostic`, puis affichage du résultat.

### Payload envoyé à l'API
```json
{
  "profile": { "income": 0, "tmi": 0, "adults": 0, "children": 0 },
  "biens": [
    {
      "nom": "...",
      "ville": "...",
      "statut": "owned",
      "regime": "micro-foncier",
      "prix": 0,
      "loyer": 0,
      "charges": 0,
      "cf_net_net": 0,
      "dscr": 0,
      "rendement_brut": 0,
      "duree_detention_mois": 0, // omis si annee-achat absent
      "interets_annuels": 0,    // omis si annee-achat absent
      "travaux": [...],
      "notes": [...]
    }
  ],
  "dashboard": {
    "total_cf": 0,
    "taux_endettement": 0,
    "capacite_emprunt": 0,
    "dscr_moyen": 0
  }
}
```

### Prompt système (server.py)
```
Tu es un conseiller en investissement immobilier locatif français. Tu reçois les données complètes du portefeuille d'un investisseur (biens détenus, biens en étude, travaux, notes, profil fiscal). Tu dois produire entre 3 et 5 recommandations priorisées, actionnables, en français naturel. Pour chaque recommandation : un titre court, une explication de 2 à 4 phrases qui justifie le conseil avec des chiffres précis issus des données, et une action concrète. Priorise les sujets fiscaux, les risques de cash-flow, et les opportunités d'optimisation. Ne fais pas de blabla introductif. Réponds en JSON : { "recommendations": [{ "title": "...", "explanation": "...", "action": "..." }] }
```

### Affichage du résultat
Panneau latéral (drawer) qui s'ouvre depuis la droite. Contient :
- Date et heure de l'analyse
- Liste des recommandations (titre + explication + action)
- Bouton "Fermer"

Le résultat est stocké dans `localStorage` sous `lastDiagnostic` de la structure `assetMeta`. À la prochaine ouverture du portefeuille, un lien discret "Voir le dernier diagnostic (08/06/2026)" apparaît sous le bouton principal.

### Gestion d'erreur
Si l'API répond avec une erreur ou timeout : toast non bloquant "Le diagnostic n'a pas pu être généré. Vérifiez votre clé API dans config.py."

---

## Ce qui est supprimé

- Section "Projection patrimoniale" (`#portfolio-projection`) — supprimée de `index.html` et de tous les rendus dans `main.js`
- Les tables "Priorités de portefeuille", "Vue fiscale consolidée", "Taux d'endettement bancaire" — remplacées par les conseils intelligents de Zone 2 qui couvrent le même contenu de façon plus lisible

---

## Comportements limites

| Cas | Comportement |
|---|---|
| 0 bien enregistré | Message d'accueil, invitation à créer une étude |
| 0 bien détenu (que du pipeline) | Zones 1, 2, 3 masquées, seule la Zone 4 visible |
| Bien sans crédit (achat comptant) | Segment "Banque" à 0 dans le donut, pas d'erreur |
| Travaux déductibles > loyers annuels | Affiché tel quel, conseil "vérifier avec comptable" ajouté |
| Diagnostic IA avec notes vides | Les notes sont omises du payload (pas de clé `notes`) |
| Clé API absente dans config.py | Bouton "Diagnostic IA" désactivé avec tooltip "Clé API non configurée" |

---

## Non-objectifs (hors périmètre)

- Synchronisation cloud des travaux et notes
- Export des travaux en CSV ou PDF
- Historique des diagnostics IA (seul le dernier est conservé)
- Modification d'une note existante (ajout uniquement)
- Intégration comptable externe
