# Revenus historisés + onglet Profil

## Contexte

Le TMI du foyer pilote tous les calculs d'impôt du portefeuille. Aujourd'hui `profileData.income` est un seul chiffre, saisi une fois via une modale, utilisé tel quel par `getOwnedTmi()` (owned-portfolio.js) — y compris par les fonctions qui reconstruisent une année fiscale *passée* précise (`computeCompteResultat`, `computeDeclaration2044`, l'onglet Impôt). Un utilisateur dont le revenu augmente d'une année sur l'autre voit donc son année N-2 recalculée avec le revenu d'aujourd'hui, faussant impôt/déficit/2044.

Repéré en creusant un cas réel où deux écrans (bannière "taux courant" vs compte de résultat de l'année) affichaient des chiffres très différents pour le même bien — un bug de proratisation des charges (déjà corrigé, voir commit `ad0dbb2`), mais qui a mis en évidence que le TMI figé est une source de divergence potentielle du même genre pour tout utilisateur dont le revenu évolue.

## Décisions validées avec l'utilisateur

1. **Modèle** : `profileData.revenuHistorique = [{ annee, revenu }]`, même logique de résolution que `loyerHistorique` (`{mois, montant}`) — la dernière entrée dont `annee <= annee-cible` s'applique ; avant la première entrée, on retient quand même la première valeur. `profileData.income` reste en fallback (compat rétro, tant qu'aucune entrée n'existe).
2. **Contenu d'une entrée** : uniquement le revenu total du foyer (pas de ventilation par personne, pas de composition adultes/enfants historisée — ces deux derniers restent des champs simples, non historisés).
3. **Portée du calcul** : TMI résolu **par année** dans toutes les fonctions qui reconstruisent une année fiscale précise ou une timeline multi-année (voir liste ci-dessous). `computeOwnedAssetCF` (le "taux courant", affiché partout sous « CF net-net / mois ») garde un TMI figé sur le revenu actuel — cohérent avec sa sémantique déjà établie (voir `[[project_portfolio_audit]]`, section 2026-08-03).
4. **UI** : nouvel onglet **"Profil"**, au même niveau que "Vue d'ensemble"/"Impôt" (`.owned-list-tabs`), sur PC **et** téléphone. Contient tout ce qui est aujourd'hui dans la modale Profil : nom, revenu (historique), adultes, enfants, objectif CF, revalorisation annuelle, autres crédits.
5. **Onboarding** : la modale Profil actuelle est conservée mais uniquement pour le tout premier remplissage (`!state.profileConfigured`). Une fois configuré, le bouton du topbar renvoie vers l'onglet Profil au lieu d'ouvrir la modale.
6. **Synchronisation cloud** : `portfolioMeta/main.profile` ne pousse aujourd'hui que `{income, adults, children}`. À étendre à tout le profil (`revenuHistorique`, `autresCredits`, `objectifCF`, `revaloAnnuelle`) pour que le téléphone ait les mêmes données que le PC.
7. **Pas de script de migration** : le fallback sur `income` couvre la transition. À la première entrée ajoutée dans l'UI, pré-remplir avec l'année en cours + le revenu actuel.

## Fonctions calculs.js à faire évoluer

Signature `(..., tmi, ...)` → `(..., profileData, ...)`, résolution interne via `calculateTMI(resolveRevenuFoyer(profileData, annee), { adults, children })` :

- `computeOwnedAssetTimeline(asset, profileData, regimeOverride)` — TMI résolu **par année de la boucle**, pas une seule fois pour toute la timeline.
- `computeDeficitFoncierHistorique(asset, profileData)` — passe `profileData` à `computeOwnedAssetTimeline`.
- `computeCompteResultat(asset, annee, profileData, regime)`
- `computeDeclaration2044(assets, annee, profileData)`
- `computeRevenuFoncierPortefeuille(assets, annee, profileData, regime)`
- `computeCFBreakdown(asset, profileData, regime, targetYear, targetMonth)`
- `computeRegimeComparison(asset, profileData, targetYears)`
- `computeSimulationTravaux(asset, montantTravaux, annee, deductible, profileData, regime)`
- `computePortfolioAlerts(assets, profileData, regime, revenusMensuels)`

Inchangées (gardent un `tmi` figé, résolu une fois par l'appelant sur l'année courante) : `computeOwnedAssetCF`, `getOptimalRegime`, `computeEndettementGlobal` (ne prend pas de TMI).

Nouvelle fonction pure : `resolveRevenuFoyer(profileData, annee)`, calquée sur `resolveLoyerFromHistorique`.

## Impact owned-portfolio.js

~20 points d'appel à `getOwnedTmi()` à trier : ceux qui alimentent une fonction de la liste ci-dessus passent désormais `state.profileData` directement ; les autres (taux courant) gardent `getOwnedTmi()` (qui reste `() => calculateTMI(resolveRevenuFoyer(profileData, anneeCourante), {...})`, donc identique en pratique à aujourd'hui pour le "maintenant").

## Hors périmètre

- Étiquetage clair des métriques "taux courant" vs "année précise" à l'écran — sujet **distinct**, traité séparément juste après ce chantier (accord explicite avec l'utilisateur).
- Historisation de la composition du foyer (adultes/enfants).
