# Spec — Portefeuille : séparation totale + simulateur matrice

**Date :** 2026-06-11  
**Statut :** Approuvé

---

## Objectif

Séparer complètement l'outil Analyse (prospection) du Portefeuille (gestion post-acquisition). Le Portefeuille devient un outil autonome où l'utilisateur saisit les caractéristiques d'un bien acquis, suit les éléments post-achat, et simule des scénarios via une matrice.

---

## Périmètre

### Inclus
- Nouveau modèle de données `portfolioOwnedAssets` dans `localStorage` (indépendant de `assetRecords`)
- Vue globale : liste des biens avec KPIs consolidés (CF net-net, rendement brut, DSCR)
- Vue détaillée par bien : 3 accordéons multi-ouvrables
  - **Acquisition** : données figées au moment de l'achat
  - **Post-achat** : données évolutives (travaux, taxe foncière, charges)
  - **Simulateur** : matrice scénarios
- Simulateur matrice : variables en lignes, scénarios nommés en colonnes, CF net-net calculé par colonne
- Bouton "Diagnostic IA" par bien (appel Claude API existant)
- Suppression du bouton "Charger dans le simulateur" qui renvoyait vers l'Analyse

### Exclu
- Migration des biens existants de `assetRecords` vers `portfolioOwnedAssets`
- Export PDF du simulateur
- Scanner (inchangé)
- Section Analyse (inchangée)

---

## Modèle de données

Clé localStorage : `portfolioOwnedAssets`

```json
{
  "<uuid>": {
    "id": "uuid",
    "nom": "Appartement Lyon 3e",
    "ville": "Lyon",
    "anneeAchat": 2022,
    "acquisition": {
      "prix": 145000,
      "fraisAgence": 4000,
      "fraisNotaire": 11600,
      "loyerInitial": 870,
      "credit": {
        "montant": 200000,
        "duree": 20,
        "taux": 3.2,
        "assurance": 0.1
      }
    },
    "postAchat": {
      "taxeFonciere": 1100,
      "chargesCopro": 80,
      "gestionLocative": 0,
      "assurancePNO": 0,
      "travaux": [
        {
          "id": "uuid",
          "date": "2024-03-15",
          "description": "Remplacement chaudière",
          "montant": 1200,
          "tag": "deductible",
          "credit": null
        }
      ],
      "notes": [
        { "id": "uuid", "createdAt": "2026-06-11T10:00:00", "text": "..." }
      ]
    },
    "scenarios": [
      {
        "id": "pessimiste",
        "nom": "Pessimiste",
        "variables": {
          "loyer": 820,
          "taxeFonciere": 1400,
          "vacance": 8,
          "regime": "micro-foncier"
        }
      },
      {
        "id": "realiste",
        "nom": "Réaliste",
        "variables": {
          "loyer": 870,
          "taxeFonciere": 1100,
          "vacance": 5,
          "regime": "micro-foncier"
        }
      },
      {
        "id": "optimiste",
        "nom": "Optimiste",
        "variables": {
          "loyer": 950,
          "taxeFonciere": 1100,
          "vacance": 2,
          "regime": "reel"
        }
      }
    ],
    "lastDiagnostic": null
  }
}
```

Les travaux peuvent avoir un `credit` optionnel `{ montant, duree, taux }` si financés par emprunt — leur mensualité s'additionne aux charges mensuelles.

---

## Vue globale — liste des biens

Tableau avec colonnes :
- Nom · Ville · Année d'achat
- CF net-net (€/mois) — calculé depuis le scénario "Réaliste" ou le premier scénario
- Rendement brut (%)
- DSCR
- Statut (badge : RAS / À surveiller / Action recommandée)

KPIs consolidés en bandeau au-dessus :
- CF net-net total / mois
- Rendement brut moyen
- Nombre de biens

Bouton **"+ Ajouter un bien"** → ouvre formulaire de création (saisit nom + ville minimum, le reste dans la fiche).

Clic sur une ligne → ouvre la vue détaillée (même page, panneau qui remplace la liste ou scroll).

---

## Vue détaillée — 3 accordéons

Chaque accordéon a un header cliquable. Plusieurs peuvent être ouverts simultanément. État d'ouverture persisté en mémoire de session (pas en localStorage).

### Accordéon 1 — Acquisition (données figées)

Champs :
- Prix d'achat (€)
- Frais d'agence (€)
- Frais de notaire (€) — pré-calculé ou saisi manuellement
- Loyer initial (€/mois)
- Crédit : montant (€), durée (ans), taux (%), assurance (%)
- Année d'achat

Résumé affiché dans le header fermé : `160 600 € investis`.

### Accordéon 2 — Post-achat (données évolutives)

**Charges récurrentes :**
- Taxe foncière (€/an)
- Charges de copropriété (€/mois)
- Gestion locative (% du loyer ou €/mois)
- Assurance PNO (€/an)

**Travaux :**
- Liste chronologique (date, description, montant, tag fiscal, crédit optionnel)
- Tags : `deductible` / `non-deductible` / `a-classifier`
- Si crédit travaux : montant + durée + taux → mensualité calculée et ajoutée aux charges
- Bouton "+ Ajouter un travail"
- Totaux par tag pour l'année en cours

**Notes :** zone de texte libre + liste horodatée.

Résumé dans le header fermé : alerte si travaux `a-classifier`.

### Accordéon 3 — Simulateur (matrice scénarios)

Tableau avec :
- **Lignes = variables modifiables** : Loyer (€/mois), Taxe foncière (€/an), Vacance (%), Régime fiscal, Charges copro (€/mois)
- **Colonnes = scénarios nommés** : Pessimiste / Réaliste / Optimiste + bouton "+ Ajouter scénario"
- **Ligne résultat** (fond distinct) : **CF net-net / mois** calculé par `calculs.js` pour chaque scénario

Chaque cellule variable est un `<input>` éditable. Le CF recalcule à chaque changement.

Variables non saisies dans un scénario → héritent des données Acquisition + Post-achat.

Le scénario "Réaliste" est mis en évidence (bordure dorée) — c'est celui utilisé pour la vue globale.

---

## Diagnostic IA

Bouton **"✦ Diagnostic IA"** dans le header de la fiche détaillée.

Payload envoyé à `POST /api/portfolio-diagnostic` :

```json
{
  "bien": {
    "nom": "...",
    "ville": "...",
    "anneeAchat": 2022,
    "acquisition": { ... },
    "postAchat": { "taxeFonciere": 1100, "travaux": [...], "notes": [...] },
    "scenarios": [
      { "nom": "Réaliste", "cfNetNet": 210 },
      { "nom": "Pessimiste", "cfNetNet": 92 },
      { "nom": "Optimiste", "cfNetNet": 318 }
    ]
  }
}
```

Retourne des recommandations affichées dans un drawer latéral (réutilise le pattern existant).

---

## Calculs

Le CF net-net de chaque scénario est calculé via une nouvelle fonction `computeOwnedAssetCF(asset, scenario)` dans `calculs.js` :

1. Loyer effectif = `scenario.loyer * (1 - scenario.vacance/100)`
2. Charges mensuelles = taxe foncière/12 + charges copro + gestion + assurance PNO + mensualités travaux empruntés
3. Mensualité crédit principal = calculée depuis `acquisition.credit`
4. Impôts = selon `scenario.regime` (micro-foncier : 30% abattement puis TMI/prélèvements sociaux ; réel : revenus - charges déductibles - intérêts)
5. CF net-net = loyer effectif - mensualité crédit - charges mensuelles - impôts mensualisés

TMI utilisé : celui du profil utilisateur (`profileData.tmi` ou calculé depuis `profileData.income`).

---

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `main.js` | Nouveaux helpers `portfolioOwned*`, rendu vue globale + vue détaillée, accordéons, CRUD travaux/notes/scénarios |
| `index.html` | Restructuration `collection-panel` — suppression anciens conteneurs, ajout nouveaux |
| `calculs.js` | Nouvelle fonction pure `computeOwnedAssetCF(asset, scenario, tmi)` |
| `styles.css` | Styles accordéons, matrice simulateur, liste biens |
| `server.py` | Adaptation endpoint `/api/portfolio-diagnostic` pour payload bien unique |

`assetRecords` et toutes les fonctions `buildPortfolio*` existantes : **supprimés ou remplacés**.

---

## Comportements limites

| Cas | Comportement |
|---|---|
| 0 bien dans le portefeuille | Message d'accueil + bouton "Ajouter mon premier bien" |
| Bien sans crédit (comptant) | Mensualité = 0, pas d'erreur |
| Scénario sans valeur pour une variable | Hérite de la valeur Acquisition/Post-achat |
| Travail avec crédit | Mensualité calculée et incluse dans les charges du bien |
| TMI non renseigné | Calcul avec TMI = 0 (impôts sous-estimés), indication visuelle |

---

## Non-objectifs

- Synchronisation cloud
- Export PDF des scénarios
- Historique des diagnostics IA (seul le dernier conservé par bien)
- Modification de notes existantes
- Vue consolidée multi-biens avancée (hors bandeau KPIs)
