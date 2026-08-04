# Portfolio Advanced Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter suivi patrimonial, trésorerie réelle, analyse dette, optimisation fiscale et dashboard dirigeant dans le module portefeuille.

**Architecture:** Toutes les nouvelles fonctions de calcul vont dans `calculs.js` (pur, zéro DOM). Le rendu et les événements vont dans `main.js`. Les nouvelles modales sont générées via `innerHTML` au moment de l'ouverture.

**Tech Stack:** Vanilla JS ES Modules, Chart.js (déjà chargé), localStorage, Flask/PyWebView

---

## Fichiers modifiés

| Fichier | Changements |
|---|---|
| `calculs.js` | +11 fonctions export |
| `main.js` | +CRUD loyersReels/déficits/goals, +render dashboard/loyers/déficits/modales |
| `index.html` | +containers modales (compte résultat, travaux, capacité, objectifs, rapport) |
| `styles.css` | +classes dashboard, jauge, loyers, déficits, modales |

---

### Task 1 : Fonctions calculs.js

- [ ] Ajouter `computeAmortizationSchedule(montant, tauxAnnuel, dureeAns)` → array years avec { year, interets, capital, crdDebut, crdFin }
- [ ] Ajouter `computePatrimoineNet(asset)` → { valeurEstimee, crd, dateEstimation, patrimoineNet }
- [ ] Ajouter `computeEndettementGlobal(assets, revenusMensuels)` → { totalMensualites, tauxEndettement, capaciteResiduelle }
- [ ] Ajouter `computeCapaciteEmprunt(mensualiteMax, dureeAns, tauxPct, apport)` → { montantEmpruntable, prixAchatMax }
- [ ] Ajouter `computeTresorerieReelle(asset, tmi, regime)` → { tauxOccupation, cfReelMoyen, cfPrevisionnel, ecart }
- [ ] Ajouter `computeCompteResultat(asset, annee, tmi, regime)` → objet compte de résultat complet
- [ ] Ajouter `getOptimalRegime(asset, tmi)` → { optimal, optimalCF, currentCF, gain }
- [ ] Ajouter `computeRevenusLocatifsBruts(assets)` → total €/an
- [ ] Ajouter `computePortfolioAlerts(assets, tmi, regime, revenusMensuels)` → alertes[]
- [ ] Ajouter `computeSimulationTravaux(asset, montantTravaux, annee, deductible, tmi, regime)`
- [ ] Mettre à jour import dans main.js

### Task 2 : CRUD main.js

- [ ] `addOwnedLoyerReel(assetId, {mois, montant, statut})`
- [ ] `deleteOwnedLoyerReel(assetId, mois)`
- [ ] `addOwnedDeficitFoncier(assetId, {annee, montant})`
- [ ] `deleteOwnedDeficitFoncier(assetId, annee)`
- [ ] `loadPortfolioGoals()` / `savePortfolioGoals(goals)`

### Task 3 : renderAccordionAcquisition — valeurEstimée + graphique CRD

- [ ] Ajouter 2 champs : valeurEstimee (number) + dateEstimation (month)
- [ ] Nouveau graphique "Capital restant dû" (canvas owned-crd-chart, pleine largeur)
- [ ] renderOwnedCrdChart(asset) séparé, appelé depuis renderOwnedDetail

### Task 4 : renderOwnedSynthese — patrimoine net + régime optimal

- [ ] Carte "Patrimoine net" (valeurEstimee - CRD)
- [ ] Badge "✓ Optimal" sur régime gagnant dans defisca cards
- [ ] Alerte si régime actuel ≠ optimal : "Vous seriez +X €/mois en [régime optimal]"
- [ ] Alerte revenus > 15k€ : "Micro-foncier interdit"

### Task 5 : renderAccordionPostAchat — loyers réels + déficits

- [ ] Section "Suivi des loyers" : table 12 derniers mois + formulaire ajout
- [ ] KPIs trésorerie (taux occupation, CF réel, écart prévisionnel) dans synthèse
- [ ] Section "Déficits fonciers reportables" : table + formulaire ajout

### Task 6 : Modales

- [ ] Compte de résultat annuel : openCompteResultatModal(assetId)
- [ ] Simulation travaux : openSimulationTravauxModal(assetId)  
- [ ] Capacité d'emprunt : openCapaciteEmpruntModal(assets)

### Task 7 : Vue liste — dashboard dirigeant

- [ ] renderOwnedDashboard(list, tmi, regime, revenusMensuels) avant KPI banner
- [ ] Ligne 1 : 4 cartes snapshot (patrimoine net total, CF, endettement, prochain crédit)
- [ ] Ligne 2 : alertes dynamiques
- [ ] Jauge endettement dans KPI banner (ou section dédiée)

### Task 8 : Objectifs

- [ ] loadPortfolioGoals / savePortfolioGoals
- [ ] openObjectifsModal() : form cfCible, patrimoineCible, dateObjectif
- [ ] Ligne 3 dashboard : barres progression + projections

### Task 9 : Rapport annuel

- [ ] openRapportAnnuelModal(assets, tmi, regime, annee) 
- [ ] Rapport texte consolidé + bouton "Copier"

### Task 10 : index.html, styles.css, câblage

- [ ] Containers modales dans index.html
- [ ] Classes CSS dashboard, jauge, loyers, déficits
- [ ] Câblage events initOwnedPortfolioEvents
- [ ] CODEBASE_MAP.md update
