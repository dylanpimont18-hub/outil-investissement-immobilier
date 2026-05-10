# Sauvegarde utile pour une réécriture web desktop

Date : 8 mai 2026

## Objectif

Conserver ce qui est réellement pertinent dans l'application actuelle avant une réécriture orientée page web desktop, pensée pour un et deux écrans.

L'idée est de garder le noyau métier fiable, les briques d'analyse qui apportent de la valeur, et d'écarter ce qui relève surtout du mobile, de la PWA ou de la commercialisation.

## Conclusion rapide

Le noyau calculatoire est globalement sain et mérite d'être conservé.

Les calculs financiers, fiscaux, la projection annuelle, la comparaison des régimes et la logique de revente sont cohérents entre eux. La couche d'interprétation est utile, mais elle contient quelques hypothèses fortes qu'il faudra expliciter dans la future version desktop.

Un point concret a été corrigé pendant cet audit : l'export PDF ne reconnaissait plus les classes CSS actuelles du verdict, ce qui pouvait fausser la couleur du score exporté sans toucher aux chiffres.

## Vérification du noyau métier

### 1. Calculs à conserver sans réserve

- Fichier : [calculs.js](../calculs.js)
- Adresse absolue : C:\Users\Dylan\Desktop\Creation_site\Investissement\calculs.js

Pourquoi le conserver :

- calculateTMI centralise le calcul du taux marginal utilisé partout.
- computeCF est la vraie source de vérité du cash-flow net-net mensuel.
- computeProjectMetrics regroupe les KPI utiles au comparateur et au scoring rapide.
- computeResaleTimeline formalise la logique de revente et de plus-value.

Verdict : c'est le premier fichier à récupérer dans une réécriture.

### 2. Analyse métier utile, mais mêlée à de l'interface

- Fichier : [main.js](../main.js)
- Adresse absolue : C:\Users\Dylan\Desktop\Creation_site\Investissement\main.js

Ce qu'il faut sauvegarder dans ce fichier :

- la lecture structurée des entrées ;
- le pipeline calculateAndSave qui transforme les entrées en analyse complète ;
- la projection 25 ans ;
- la logique de seuil de rentabilité, enrichissement et revente ;
- la logique de faisabilité type prix max / loyer minimum.

Ce qu'il ne faut pas considérer comme prioritaire pour la réécriture desktop :

- le billing ;
- les limitations Pro+ ;
- le service worker ;
- la logique d'installation PWA ;
- les modales marketing et de monétisation.

Verdict : conserver le fichier entier comme archive, mais réextraire seulement les blocs métier dans la future app.

### 3. Interprétation et restitution analytique utiles

- Fichier : [ui.js](../ui.js)
- Adresse absolue : C:\Users\Dylan\Desktop\Creation_site\Investissement\ui.js

Ce fichier vaut la peine d'être gardé pour :

- le verdict de score ;
- la comparaison des régimes ;
- les conseils d'optimisation ;
- les tableaux de négociation ;
- la validation simple des entrées.

Verdict : bon candidat à la réutilisation, surtout si la future version garde une logique d'aide à la décision et pas seulement une calculette brute.

### 4. Méthodologie et structure d'analyse à sauvegarder

- Fichier : [index.html](../index.html)
- Adresse absolue : C:\Users\Dylan\Desktop\Creation_site\Investissement\index.html

À préserver en priorité dans ce fichier :

- la section Comprendre les calculs — Méthodologie ;
- les conteneurs de résultats d'analyse ;
- les zones dédiées au score, aux KPI, aux tableaux de projection, à la revente et à la fiscalité comparée.

Verdict : à conserver comme banque de structure et de contenu métier, pas comme maquette finale desktop.

### 5. Styles à garder partiellement

- Fichier : [styles.css](../styles.css)
- Adresse absolue : C:\Users\Dylan\Desktop\Creation_site\Investissement\styles.css

À récupérer surtout :

- les cartes KPI ;
- les tableaux analytiques ;
- les styles de verdict ;
- la méthodologie ;
- les blocs de comparaison fiscale et de négociation.

À ne pas reprendre tel quel :

- la navigation d'onglets collée en bas ;
- les ajustements safe-area ;
- les bannières d'installation ;
- la logique très orientée mobile et PWA.

Verdict : utile comme réserve de composants, pas comme feuille de style finale.

### 6. Export à garder en option

- Fichier : [pdf.js](../pdf.js)
- Adresse absolue : C:\Users\Dylan\Desktop\Creation_site\Investissement\pdf.js

Ce fichier reste pertinent si la future version desktop conserve l'export de rapport.

Point important : il mélange impression navigateur et génération client-side. C'est utile, mais secondaire par rapport au moteur d'analyse.

Verdict : optionnel mais récupérable.

## Hypothèses et limites à connaître

### TMI

Le simulateur appelle actuellement le calcul du TMI avec une hypothèse fixe de 2 enfants pour le quotient familial. C'est documenté dans l'interface, mais cela reste une hypothèse forte. Si la future version desktop vise une utilisation plus large, il faudra rendre cette donnée explicite et paramétrable.

### Score de l'investissement

Le score est un score de décision rapide. Il repose sur deux variables seulement :

- le cash-flow net-net ;
- la rentabilité nette.

Il ne tient pas compte à lui seul :

- de l'enrichissement patrimonial ;
- de la stratégie de revente ;
- du contexte local du marché ;
- du risque opérationnel.

La logique est cohérente, mais il faut la présenter comme un raccourci décisionnel, pas comme un jugement total.

### Mélange métier / shell applicatif

Le projet actuel mêle dans les mêmes fichiers :

- le métier calculatoire ;
- le rendu analytique ;
- le packaging mobile/PWA ;
- la monétisation.

Pour la réécriture desktop, il faudra séparer nettement ces couches.

## Fichiers à conserver en priorité

Ordre recommandé de récupération :

1. [calculs.js](../calculs.js)
2. [ui.js](../ui.js)
3. [main.js](../main.js)
4. [index.html](../index.html)
5. [styles.css](../styles.css)
6. [pdf.js](../pdf.js)

## Fichiers non prioritaires pour une version desktop centrée analyse

- [manifest.json](../manifest.json)
- [sw.js](../sw.js)
- [billing.js](../billing.js)
- [billing.config.js](../billing.config.js)
- [script.js](../script.js)
- [README_mobile_only_stores.txt](../README_mobile_only_stores.txt)
- [README_commercialisation_web.md](../README_commercialisation_web.md)
- [README_lancement_web_7_jours.md](../README_lancement_web_7_jours.md)
- [README_netlify_pas_a_pas.md](../README_netlify_pas_a_pas.md)
- [README_supabase_stripe.md](../README_supabase_stripe.md)

## Recommandation de migration

Pour une nouvelle version optimisée bureau :

1. repartir de [calculs.js](../calculs.js) comme noyau pur ;
2. réextraire depuis [main.js](../main.js) uniquement les transformations analytiques ;
3. réutiliser depuis [ui.js](../ui.js) la logique de verdict, de comparaison et de conseils ;
4. reprendre depuis [index.html](../index.html) la méthodologie et les blocs de résultats ;
5. reconstruire entièrement la mise en page desktop au lieu d'adapter la coque mobile actuelle.