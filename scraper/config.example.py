# Copier ce fichier en config.py et remplir les valeurs réelles.
# config.py est dans .gitignore — ne jamais commiter les vraies clés.

# Région — liste de villes à scraper
VILLES = [
    {"ville": "Bourges", "code_postal": "18000", "dept": "18"},
    # Ajouter d'autres villes...
]

DEPARTEMENTS = ["18"]

# Crédit
TAUX_CREDIT = 3.35    # % annuel hors assurance
ASSURANCE   = 0.30    # % annuel du capital
DUREE_MOIS  = 240     # 20 ans

# Loyers (€/m²/mois)
LOYER_M2_APPARTEMENT  = 9.0
LOYER_M2_MAISON       = 8.0
LOYER_MAX_APPARTEMENT = 800
LOYER_MAX_MAISON      = 900

# Charges mensuelles par défaut
CHARGES_COPRO_APPARTEMENT = 30
CHARGES_COPRO_MAISON      = 0

# Ratios annuels → part mensuelle
TAXE_FONCIERE_RATIO = 1 / 12
VACANCE_RATIO       = 1 / 12

# Fiscalité micro-foncier
TMI = 30  # Taux Marginal d'Imposition en %

# Filtres prix
PRIX_MIN = 10_000
PRIX_MAX = 600_000

# Clé API Anthropic — console.anthropic.com
ANTHROPIC_API_KEY = "sk-ant-REMPLACE_PAR_TA_CLE"

# Scrapers à activer (commenter pour désactiver)
SCRAPERS_ACTIFS = [
    "leboncoin",
    "pap",
    "seloger",
    "logicimmo",
    "bienici",
    "orpi",
    "century21",
    "laforet",
    "notaires",
    "bellesdemeures",
]
