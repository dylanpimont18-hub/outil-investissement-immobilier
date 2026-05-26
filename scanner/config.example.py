# Copier ce fichier en config.py et remplir les valeurs réelles.
# config.py est dans .gitignore — ne jamais commiter les vraies clés.

# Recherche
CODE_POSTAL = "18100"

# Crédit
TAUX_CREDIT = 3.35       # % annuel (hors assurance)
ASSURANCE = 0.30         # % annuel du capital emprunté
APPORT = 0               # €
DUREE_MOIS = 240         # 20 ans

# Loyers estimés (€/m²/mois)
LOYER_M2_APPARTEMENT = 9.9
LOYER_M2_MAISON = 8.9

# Plafonds de loyer mensuel
LOYER_MAX_APPARTEMENT = 650   # €/mois
LOYER_MAX_MAISON = 750        # €/mois

# Charges mensuelles
CHARGES_COPRO_APPARTEMENT = 25  # €/mois
CHARGES_COPRO_MAISON = 0        # €/mois

# Taxe foncière : 1 mois de loyer par an (part mensuelle)
TAXE_FONCIERE_RATIO = 1 / 12

# Vacance locative : 1 mois par an (part mensuelle)
VACANCE_RATIO = 1 / 12

# Clé API Anthropic — https://console.anthropic.com
ANTHROPIC_API_KEY = "sk-ant-REMPLACE_PAR_TA_CLE"

# Fiscalité — régime micro-foncier par défaut
TMI = 30  # Taux Marginal d'Imposition en %

# Email — mot de passe d'application Google
# (Compte Google > Sécurité > Mots de passe des applications)
EMAIL_EXPEDITEUR = "ton.email@gmail.com"
EMAIL_MOT_DE_PASSE_APP = "REMPLACE_PAR_TON_MOT_DE_PASSE_APP"
EMAIL_DESTINATAIRE = "ton.email@gmail.com"
