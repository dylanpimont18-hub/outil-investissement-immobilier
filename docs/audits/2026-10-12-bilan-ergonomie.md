# Bilan d'usage et d'ergonomie — Spark Investissement 1.0.24 (12 octobre 2026)

## Méthode

- Parcours réel de l'application hébergée (même code que https://spark-investissement.web.app) avec les données de l'utilisateur, en lecture seule : 39 captures d'écran sur PC (1366 × 900) et iPhone (393 × 852), rendu « print » du PDF de décision, mesures objectives (hauteur de page, cibles tactiles < 44 px, textes < 12 px, champs sans libellé, erreurs JS, temps de chargement).
- Trois analyses indépendantes sur ces captures : ergonomie et parcours, cohérence visuelle et charte, produit et fonctionnalités manquantes (rapports détaillés dans `annexes/`).
- Chaque constat majeur a été recoupé dans le code (`styles.css`, `main.js`, `owned-portfolio.js`, `rapport-bien.js`, `calculs.js`). Les lignes citées sont celles de la version 1.0.24.
- Déjà fait pendant l'audit : la carte du portefeuille a été réduite de 30 % (420 → 294 px), déployée.

## 1. Ce qui marche bien

- Socle technique sain : 0 erreur JS, 0 ressource en échec, 0 débordement horizontal sur les trois pages ; `owned.html` tient en un écran iPhone avec 0 cible tactile sous 44 px sur la liste.
- La synthèse arrive tout de suite sur l'Analyse (verdict, score, 3 KPI avant le formulaire) ; mode guidé en 4 étapes ; glossaire et calculette accessibles sans quitter la page.
- Fiscalité du foncier réel exacte et pédagogique : barème tranche par tranche, déficit imputable/reportable, déclaration 2044 pré-remplie case par case avec « points à vérifier », projection d'impôts sur 10 ans avec phrase de synthèse.
- Saisie des frais par IA de bout en bout (photo ou PDF, lecture, nature, « financé »), utilisable sur le terrain depuis l'iPhone ; liste des travaux claire (badges, totaux).
- Historique daté du loyer et des charges, comparatif des régimes dans le temps, livrables imprimables (PDF décision bien hiérarchisé, rapport d'un bien sobre et lisible).

## 2. Bugs confirmés dans le code (à corriger en premier)

| # | Sévérité | Constat | Preuve | Correction | Effort |
|---|---|---|---|---|---|
| B1 | **P0** | Les modales **Import** et **Suppression d'un bien** n'ont pas de fond : le texte se superpose au dashboard (confirmation de suppression illisible). | `.owned-delete-modal__box { background: var(--surface-1) }` (`styles.css:7407`), `--surface-1` jamais définie. 20 variables CSS sont utilisées sans définition (`--accent-color` ×12, `--surface-2` ×10, `--color-negative` ×7, `--surface-raised` ×6, `--text-muted` ×6…). | Remplacer par `var(--surface)` ; définir ou renommer les 20 tokens orphelins. | S |
| B2 | **P0** | **Vacance cachée de 5 %** : le CF du dashboard (−20 €/mois) et le rapport du bien reposent sur la vacance du scénario « réaliste », dont l'éditeur est masqué, alors que l'onglet Exploitation affiche 0 %. | `rapport-bien.js:52` (`scenario.variables?.vacance ?? 5`), `owned-portfolio.js:181`, `index.html:783` (`#acc-simulateur-content hidden`). | Une seule source de vacance : celle de l'onglet Exploitation. | S |
| B3 | **P0** | **Rapport du bien faux** : 641 − 82 − 492 = +67 € mais « Cash-flow net −68 € » (frais ponctuels absents du tableau) ; mensualité 492 € contre 470 € dans l'onglet Calcul. C'est le document partagé avec un banquier. | Capture `pc-25` vs `pc-24`. | Ligne « frais ponctuels non financés (÷ 12) », même mensualité que la fiche, test « somme des lignes = total ». | M |
| B4 | **P1** | **Échap ne ferme pas** la modale Import (PC), « Ajouter un bien » (iPhone, sans croix) ni le Rapport ; ces modales bloquent ensuite les clics. | Le gestionnaire ne vise que `.owned-modal-overlay` (`owned-portfolio.js:495`) ; ces modales utilisent `.owned-delete-modal` / `.owned-add-modal`. | Gestionnaire Échap commun à toutes les classes de modale (ou `<dialog>`), croix sur la modale mobile. | S |
| B5 | **P1** | **Profil divergent PC / iPhone** : revalorisation 0 % saisie → 2 % sur PC (calculs PC ≠ iPhone). | `main.js:577` : `Number(rawProfile.revaloAnnuelle) \|\| 2` transforme 0 en 2 ; `owned-portfolio.js:1964` garde 0. | `Number.isFinite(x) ? x : 2`. | S |
| B6 | **P1** | **Police des chiffres jamais chargée** : 65 règles demandent IBM Plex Mono, aucune `@font-face` dans l'interface, seule Inter est chargée → les chiffres s'affichent en Courier New, à côté de chiffres en Inter sur le même écran. | `grep @font-face styles.css` = 0 ; `vendor/fonts/IBMPlexMono-*.ttf` présents (utilisés seulement par les PDF). | `@font-face` Plex Mono 400/500/600 en tête de `styles.css`, `--font-mono` dessus, remplacer les 30 déclarations en dur. | S |
| B7 | **P1** | **Rapport annuel** : « Impôts estimés : --962 € », « Capital restant dû : −0 € » (CRD réel 93 142 €), patrimoine « 0 € » ici et « — » au dashboard, intérêts comptés dans les charges ET dans les mensualités. | Capture `pc-16`. | Formatage du signe, CRD, séparer trésorerie et fiscal, « non renseigné ». | S |
| B8 | **P1** | **Écarts fiscaux entre écrans** : déficit reportable 1 421 € (déclaration, case 439) vs 1 231 € (fiche, Impôts à venir) ; imputable sur le revenu global 8 577 € vs 8 747 €. | Captures `pc-17`, `pc-18`, `pc-22`. | Une seule fonction de résultat foncier annuel (`computeDeclaration2044` comme source) réutilisée partout, test de cohérence. | M |
| B9 | **P1** | **Taxe foncière comptée deux fois** quand elle est saisie en frais « déductible » (ici 334 €) ET dans les charges (342 €) : case 224 + case 227. Frais de garantie (750 €) en case 224 et courtage (1 250 €) non déductible, alors que ce sont des frais d'emprunt (case 250). | `calculs.js:2343-2356` (`travauxDed` + `taxeFonciere` additionnés sans garde), `pc-23`, `pc-17`. | Natures « Frais d'emprunt (250) » et « Taxe foncière (227) », alerte doublon, suggestion par l'IA de lecture. | M |
| B10 | **P1** | **`index.html` sur iPhone est inutilisable** : page de 11 492 px, barre latérale sur la moitié de l'écran, titres coupés. | Captures `m-01`, `m-02`. | Sous 700 px : bandeau « Version mobile → /portefeuille » ou redirection. | S |
| B11 | **P1** | **Bouton flottant** (factures, et ✦ sur iPhone) recouvre des champs et des boutons : colonne Impôt, croix des crédits, champ Montant du formulaire Travaux, Revalorisation, badge « non déductible ». | `pc-13`, `pc-14`, `pc-23`, `m-05`, `m-11`. | `padding-bottom` de la hauteur du bouton + 16 px sur les conteneurs ; sur mobile, un seul bouton avec menu. | S |
| B12 | **P1** | **Cibles tactiles iPhone** : 56 boutons sous 44 px dans Travaux (supprimer 21 × 16, justificatif 21 × 15, case 20 × 20), 4 dans Profil (18 × 16), onglets « An 1/3/5/10 » à 22 px. | Mesures `audit-facts.json`. | Zone tactile 44 × 44 (padding transparent), 8 px d'écart, menu « ⋯ » par ligne sur mobile. | M |

## 3. Ergonomie : les constats qui comptent

1. **Cinq valeurs de cash-flow pour le même bien, sans période** : −20 € (dashboard, « rythme actuel » avec vacance 5 % et frais ponctuels ÷ 12), −13 € (liste, « An 1 » = −153 € de 2026 ÷ 12 alors que le bien n'est détenu que 5 mois), −153 €/an, +2 €/mois (An 10), −68 € (rapport). Aucun n'est le CF d'une année pleine (+42 €/mois en 2027). Libeller chaque chiffre par sa base et ajouter un « CF récurrent (année pleine N+1) ».
2. **Le verdict « Offre non recevable 62/100 » effraie à tort** : prix sous le plafond, CF +104 €, DSCR 1,29 ; le blocage vient de la fiabilité des hypothèses (50/100), et l'action proposée renvoie à une checklist qui n'existe que dans le PDF. Distinguer « Dossier à documenter » (ambre) de « Économie défavorable » (rouge) ; décomposer le score au clic.
3. **Sept cartes de l'Analyse paraissent vides** (Solidité des hypothèses, Scénarios de stress, Régimes fiscaux, Journal de décision…) : ce sont des blocs repliés dont le chevron est masqué (`styles.css:5354`). L'information la plus utile n'est jamais découverte.
4. **Les contrôles de l'Analyse restent affichés sur Portefeuille et Assistant** (Dossier actif, Guidé/Complet, Enregistrer, Nouvelle étude, Exporter PDF) : deux boutons « Enregistrer » à l'écran dans l'onglet Profil.
5. **Assistant** : à 900 px de haut, le bouton Envoyer est sous la ligne de flottaison ; état vide sans suggestion.
6. **Deux comparatifs de régimes sur le même onglet** aux chiffres différents (cartes au rythme actuel, tableau par année civile) sans le dire ; signe des impôts inversé entre les deux.
7. **Lisibilité** : 180 textes sous 12 px sur Analyse (libellés des KPI à 10 px, aides à 9 px), 90 tailles de police distinctes, dates en trois formats (ISO, « 2026-08 », « 07/10/2026 »), placeholder « dd/mm/yyyy », nombres « 1,29 » et « 1.29 », « 70 000 € » et « 81000 € ».
8. **Formulaires mobiles sans libellé** (placeholder seul) : 20 champs dans Travaux, 8 dans Exploitation, 3 dans Profil.
9. **Glossaire faux** : « CF brut » défini par la formule d'un rendement.
10. **Chargement** : 2,3 à 2,7 s de texte « Chargement… » sans squelette.

## 4. Cohérence visuelle

- **Il existe trois chartes incompatibles** : `charte_graphique.txt` (Montserrat / Inter / JetBrains Mono, accent or), `CLAUDE.md` (Cormorant / Plex Mono / Manrope, or) et le code (`styles.css` : Inter partout, accent indigo `#6366F1` ; même `--accent-gold` vaut l'indigo en thème clair). L'or ne survit que par les valeurs de repli d'un token jamais défini, d'où deux couleurs d'action sur le même écran (onglet actif or à côté d'un bouton indigo sur iPhone ; « Diagnostic IA » or sur iPhone, indigo sur PC). Première décision à prendre : **une charte, puis aligner le code**.
- 32 rayons différents (`.btn` en pilule, `.btn-primary` à 8 px côte à côte), 27 ombres, 6 variantes de bouton, 3 familles d'icônes (SVG, glyphes Unicode, emoji couleur 🏠 📄 📁 ✏️ 🏦).
- Verdict répété 5 fois sur le premier écran ; seuils en vert vif plus voyants que le verdict ; vert « Tailwind » loin de l'émeraude prévue ; `excellent` et `positive` ont la même couleur.
- Graphiques : « Recettes vs dépenses » n'affiche qu'une courbe (dépenses invisibles), « CF net cumulé » sans ligne zéro ni annotation du saut de 2050 ; répartition par bien = une barre pleine pour un seul bien ; axes en Courier 9 px.
- Rapport annuel et déclaration affichés en `<pre>` ASCII ; chevron du sélecteur d'année qui recouvre le dernier chiffre ; barre vide de 34 px sous l'en-tête de chaque fiche.
- Documents : le rapport d'un bien (fond blanc, filet or, tableaux à 2 colonnes) est le meilleur gabarit ; le PDF de décision (19 dégradés, fonds beige, séparateur décimal anglais) est à aligner dessus.

## 5. Ce qui manque (produit)

| Priorité | Manque | Forme minimale |
|---|---|---|
| **P0** | **Liste et comparateur des études enregistrées** : « Enregistrer » écrit en base mais rien ne relit ; « Maison Tony » est invisible et aucune étude ne peut être rechargée, comparée ni supprimée. | Bloc « Mes études (2) » dans la barre latérale (nom, ville, prix, CF, score, date ; clic = charger ; supprimer avec confirmation), puis tableau côte à côte de 2-3 études sur les KPI déjà calculés. |
| P1 | CF récurrent (année pleine N+1) distinct du CF de l'année en cours. | Deux chiffres au dashboard, calcul déjà disponible dans `computeOwnedAssetTimeline`. |
| P1 | Échéances et rappels (TF, PNO, révision IRL, 2044, engagement 3 ans du réel, fin de bail, fin de crédit). | Section « Prochaines échéances (90 jours) » calculée dans le Centre d'actions. |
| P1 | Révision IRL du loyer. | Bouton « Réviser selon l'IRL » dans la section Loyer. |
| P1 | Étude d'achat consultable et modifiable sur iPhone (en visite). | Onglet « Études » dans `owned.html` : liste + verdict + 4 champs (prix, négociation, loyer, travaux). |
| P1 | Valeur estimée assistée (le patrimoine net est vide, le Centre d'actions le répète). | Valeur par défaut = prix + travaux immobilisés, étiquetée « non estimée ». |
| P2 | Périodes sans loyer (vacance réelle, impayés) sans revenir au suivi mensuel ; épargne de précaution ; revente / plus-value / TRI ; régime fiscal par bien (avant le 2e achat) ; export CSV ; suggestions et contexte de l'étude active dans l'Assistant ; corbeille / journal des modifications ; sauvegarde incluant études et profil. | Voir `annexes/rapport-produit.md`. |
| P3 | Recherche globale, raccourcis clavier, export .ics, plan chiffré vers l'objectif. | |

## 6. Parité PC / iPhone

L'iPhone couvre bien la saisie terrain (factures par photo, loyer, fiche complète avec onglet Calcul, Assistant, Profil, Rapport). Il ne permet ni l'Analyse d'une étude (et `index.html` y est cassé), ni le dashboard dirigeant (patrimoine, endettement, Centre d'actions, capacité d'emprunt, rapport annuel, déclaration, impôts à venir), ni l'onglet Impôt, ni le dossier bancaire, ni la carte, le tri, l'import/export, ni l'import d'un dossier de documents. Acceptable pour la saisie ; le vrai trou est la visite d'un bien à acheter, et une mini vue d'ensemble (Centre d'actions + échéances) manque pour la consultation.

## 7. Feuille de route proposée

**Lot 1 — quick wins (chacun ≤ 1 jour, la plupart ≤ 1 heure)**
1. B1 fond des modales + 20 tokens CSS orphelins ; B4 Échap commun ; B6 `@font-face` Plex Mono ; B5 revalorisation `|| 2` → `?? 2`.
2. B10 bandeau ou redirection mobile ; B11 marge sous le bouton flottant ; chevrons sur les blocs repliés de l'Analyse ; contrôles de l'Analyse masqués hors de son onglet.
3. B7 rapport annuel (signes, CRD, trésorerie / fiscal) ; chevron du sélecteur d'année ; formats de nombres et de dates FR unifiés ; glossaire « CF brut ».
4. Libellés des CF (« rythme actuel », « An 1 (2026, 5 mois) ») et division de l'année d'achat par les mois détenus ; cartes de régimes titrées par leur base.
5. Verdict « Dossier à documenter » quand seule la fiabilité bloque ; vacance 0 % marquée « optimiste » dans le PDF ; suggestions dans l'état vide de l'Assistant ; zone de saisie fixée en bas.

**Lot 2 — chantier d'une semaine**
1. B2 vacance unique + B3 rapport du bien juste (ligne frais ponctuels, mensualité cohérente, test somme = total).
2. Comparateur d'études (P0), puis sa version iPhone.
3. Cohérence fiscale : source unique du résultat foncier (B8), natures « frais d'emprunt 250 » et « taxe foncière 227 » avec alerte doublon (B9), libellé du revenu « net imposable après abattement de 10 % ».
4. CF récurrent N+1 au dashboard ; échéances calculées dans le Centre d'actions ; révision IRL.
5. B12 cibles tactiles iPhone (menu « ⋯ » par ligne), libellés des formulaires mobiles.

**Lot 3 — plus tard**
1. Une seule charte : accent unique (or ou indigo, mais un seul), échelle de 6 tailles de police, 2 rayons, 3 boutons, icônes SVG, palette de données commune, rapport d'un bien comme gabarit des PDF.
2. Revente / plus-value / TRI ; régime fiscal par bien ; périodes sans loyer ; épargne de précaution ; export CSV ; corbeille et journal ; squelette de chargement.

## Annexes

- `annexes/rapport-ergonomie.md` — 30 constats, 4 parcours critiques, top 5.
- `annexes/rapport-visuel.md` — charte vs réalité (13 lignes), 24 constats, 12 règles de direction.
- `annexes/rapport-produit.md` — 19 manques, 24 incohérences, parité PC/iPhone, feuille de route.
- Les 39 captures et les mesures brutes (`audit-facts*.json`) sont dans le dossier temporaire de la session d'audit, non versionnées.
