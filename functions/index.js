const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

const mammouthApiKey = defineSecret('MAMMOUTH_API_KEY');

// Uniquement des images : Mammouth AI (proxy vers gpt-4o) n'accepte pas les PDF sur ce plan/cette
// region ('image_url' rejette tout MIME hors image/*, et le mode 'file' natif OpenAI renvoie "File
// input is not supported in this region") — voir le changement de fournisseur du 2026-08-04
// (credit Anthropic epuise, cf. memoire projet_portfolio_audit).
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const ALLOWED_TAGS = ['deductible', 'non-deductible', 'a-classifier'];
const ALLOWED_CONFIANCE = ['haute', 'moyenne', 'basse'];

// Limite le crédit Mammouth AI consommable par un compte compromis/abusif : pas de
// persistance nécessaire (usage familial, faux négatifs après redémarrage acceptables),
// une fenêtre glissante en mémoire suffit et évite une dépendance Firestore/admin SDK.
// Partagée entre extraireFraisFacture et extraireDossierBien (même Map, même plafond) :
// un dossier de 15-20 documents s'ajoute à l'usage Travaux normal, d'où le plafond à 30
// (relevé depuis 10 le 2026-09-22 avec l'accord explicite de l'utilisateur).
const RATE_LIMIT_MAX_CALLS = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 heure
const MAX_BASE64_LENGTH = 7_000_000; // ~5 Mo de fichier source (base64 gonfle de ~33%)
const _callTimestampsByUid = new Map();

function _checkRateLimit(uid) {
    const now = Date.now();
    const timestamps = (_callTimestampsByUid.get(uid) || []).filter(
        (t) => now - t < RATE_LIMIT_WINDOW_MS
    );
    if (timestamps.length >= RATE_LIMIT_MAX_CALLS) {
        throw new HttpsError('resource-exhausted', 'Trop de requêtes, réessayez plus tard');
    }
    timestamps.push(now);
    _callTimestampsByUid.set(uid, timestamps);
}

// Appel Mammouth AI partagé (chat/completions, image unique + prompt système) : factorise le
// fetch/User-Agent/gestion d'erreur communs à extraireFraisFacture et extraireDossierBien.
async function _callMammouthVision({ systemPrompt, userText, base64, mimeType, logLabel }) {
    let response;
    try {
        response = await fetch('https://api.mammouth.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${mammouthApiKey.value()}`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                            { type: 'text', text: userText }
                        ]
                    }
                ]
            })
        });
    } catch (err) {
        logger.error(`${logLabel}: fetch failed`, { message: err?.message, stack: err?.stack });
        throw new HttpsError('unavailable', 'Impossible de contacter le service IA');
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '<unreadable>');
        logger.error(`${logLabel}: Mammouth API error`, { status: response.status, body: errorBody, mimeType });
        throw new HttpsError('internal', `Erreur IA (${response.status})`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    try {
        return JSON.parse(raw);
    } catch (err) {
        logger.error(`${logLabel}: unparseable response`, { raw, message: err?.message });
        throw new HttpsError('internal', 'Réponse IA non exploitable');
    }
}

function _validateImageInput(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    _checkRateLimit(request.auth.uid);

    const { base64, mimeType } = request.data || {};
    if (!base64 || typeof base64 !== 'string') {
        throw new HttpsError('invalid-argument', 'Fichier manquant');
    }
    if (base64.length > MAX_BASE64_LENGTH) {
        throw new HttpsError('invalid-argument', 'Fichier trop volumineux (5 Mo max)');
    }
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        throw new HttpsError('invalid-argument', 'Format non supporté (JPG ou PNG uniquement)');
    }
    return { base64, mimeType };
}

const SYSTEM_PROMPT = `Tu es un assistant qui extrait les informations d'une facture ou d'un devis de travaux immobiliers français.
Tu réponds uniquement avec du JSON valide, sans markdown ni texte hors JSON, au format exact :
{"date": "YYYY-MM-DD", "description": "...", "montant": 0, "tagSuggestion": "deductible|non-deductible|a-classifier", "confiance": "haute|moyenne|basse"}

Règles fiscales françaises pour tagSuggestion (foncier réel) :
- deductible : entretien, réparation, amélioration (peinture, toiture, chauffage, plomberie, électricité...)
- non-deductible : agrandissement, construction, reconstruction (extension, surélévation, création de surface habitable...)
- a-classifier : si le document ne permet pas de trancher avec certitude

Si une information est illisible ou absente, laisse une chaîne vide ("") pour date/description, 0 pour montant, et mets confiance à "basse".`;

// Extraction IA d'une photo de facture/devis pour pré-remplir le formulaire d'ajout d'un frais
// dans l'onglet Travaux (owned-portfolio.js, renderOwnedTravauxTab) et le rail/FAB Actions
// rapides. Appelée à l'identique depuis index.html (PC) et owned.html (mobile). Passe par
// Mammouth AI (proxy OpenAI-compatible, modèle gpt-4o) plutôt que l'API Anthropic directe depuis
// le 2026-08-04. Le User-Agent explicite est nécessaire : Mammouth est derrière Cloudflare et
// bloque (403 / "error code 1010") les requêtes sans en-tête User-Agent de navigateur.
exports.extraireFraisFacture = onCall({ secrets: [mammouthApiKey], region: 'europe-west1', timeoutSeconds: 60 }, async (request) => {
    const { base64, mimeType } = _validateImageInput(request);

    const parsed = await _callMammouthVision({
        systemPrompt: SYSTEM_PROMPT,
        userText: 'Extrait les informations de cette facture/devis de travaux.',
        base64,
        mimeType,
        logLabel: 'extraireFraisFacture'
    });

    return {
        date: typeof parsed.date === 'string' ? parsed.date : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        montant: Number(parsed.montant) || 0,
        tagSuggestion: ALLOWED_TAGS.includes(parsed.tagSuggestion) ? parsed.tagSuggestion : 'a-classifier',
        confiance: ALLOWED_CONFIANCE.includes(parsed.confiance) ? parsed.confiance : 'basse'
    };
});

// --- extraireDossierBien : extraction multi-documents pour pré-remplir une fiche bien ---
// (acte de vente, offre de prêt, tableau d'amortissement, avis de taxe foncière, appel de
// charges copro, attestation PNO, facture de travaux...). Appelée une fois par document ; la
// fusion entre documents (résolution de conflits par confiance) se fait côté client
// (owned-portfolio.js), cette fonction ne fait qu'extraire un document à la fois — voir
// docs/superpowers/specs/2026-09-22-import-dossier-bien.md.
const DOSSIER_DOCUMENT_TYPES = [
    'acte_vente', 'offre_pret', 'tableau_amortissement', 'taxe_fonciere',
    'charges_copro', 'assurance_pno', 'facture_travaux', 'autre'
];
const DOSSIER_TYPE_BIEN = ['appartement', 'maison', 'immeuble'];

const DOSSIER_SYSTEM_PROMPT = `Tu es un assistant qui extrait les informations d'un document lié à l'achat ou la gestion d'un bien immobilier locatif français (acte de vente, offre de prêt, tableau d'amortissement, avis de taxe foncière, appel de charges de copropriété, attestation d'assurance PNO, facture de travaux, etc.).

Analyse le document fourni et retourne UNIQUEMENT un objet JSON valide (sans markdown, sans texte avant/après), avec cette structure exacte — inclus uniquement les champs que tu peux lire avec certitude dans ce document précis, omets tous les autres (ne mets jamais 0 ou une valeur inventée par défaut) :

{
  "documentType": "acte_vente | offre_pret | tableau_amortissement | taxe_fonciere | charges_copro | assurance_pno | facture_travaux | autre",
  "bien": {
    "adresse": "adresse complète du bien si présente",
    "ville": "ville",
    "codePostal": "code postal à 5 chiffres",
    "surface": nombre en m² (uniquement le nombre),
    "typeBien": "appartement | maison | immeuble"
  },
  "acquisition": {
    "prix": nombre en euros (prix net vendeur, hors frais de notaire/agence),
    "fraisNotaire": nombre en euros,
    "fraisAgence": nombre en euros,
    "dateAchat": "AAAA-MM" (mois et année de signature/acte),
    "valeurEstimee": nombre en euros (si le document mentionne une valeur estimée actuelle, différente du prix d'achat),
    "dateEstimation": "AAAA-MM"
  },
  "credit": {
    "montant": nombre en euros (capital emprunté),
    "duree": nombre en années,
    "taux": nombre en pourcentage (taux nominal hors assurance, ex: 3.2),
    "assurance": nombre en pourcentage (taux annuel assurance emprunteur, ex: 0.30)
  },
  "charges": {
    "taxeFonciere": nombre en euros PAR AN,
    "chargesCopro": nombre en euros PAR MOIS,
    "assurancePNO": nombre en euros PAR AN,
    "gestionLocative": nombre en pourcentage du loyer si mentionné
  },
  "travail": {
    "date": "AAAA-MM-JJ",
    "description": "résumé court des travaux/prestation",
    "montant": nombre en euros TTC,
    "tagSuggestion": "deductible | non-deductible | a-classifier"
  },
  "confiance": "haute | moyenne | basse"
}

Règles strictes :
- N'invente aucune valeur. Un champ absent du document ne doit PAS apparaître dans le JSON (ne mets pas null ni 0).
- Les montants sont des nombres purs (pas de symbole €, pas d'espaces, pas de virgule comme séparateur de milliers — utilise le point si décimal).
- Les dates suivent strictement le format AAAA-MM ou AAAA-MM-JJ.
- Ne remplis "acquisition"/"credit" que si le document est bien un acte de vente ou une offre de prêt — n'essaie pas de deviner un prix d'achat depuis un simple avis de taxe foncière.
- Ne remplis "travail" que si le document est une facture ou un devis de travaux (pas une charge récurrente).
- "confiance" reflète ta certitude globale sur les valeurs extraites de CE document (basse si le document est flou, partiel, ou ambigu).
- Réponds uniquement avec le JSON, sans aucun texte d'accompagnement.`;

function _cleanNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
function _cleanString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function _cleanEnum(v, allowed) {
    return allowed.includes(v) ? v : undefined;
}
function _cleanSubObject(obj, cleaners) {
    if (!obj || typeof obj !== 'object') return undefined;
    const out = {};
    for (const [key, clean] of Object.entries(cleaners)) {
        const v = clean(obj[key]);
        if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

// Nettoie/valide la réponse Mammouth champ par champ (jamais de confiance aveugle dans le JSON
// renvoyé par le modèle) : chaque sous-objet est omis entièrement si vide après nettoyage, pour
// que la fusion côté client ne voie que des valeurs réellement lues dans le document.
function _sanitizeDossierResult(parsed) {
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const out = {
        documentType: _cleanEnum(parsed.documentType, DOSSIER_DOCUMENT_TYPES) || 'autre',
        confiance: ALLOWED_CONFIANCE.includes(parsed.confiance) ? parsed.confiance : 'basse'
    };
    const bien = _cleanSubObject(parsed.bien, {
        adresse: _cleanString, ville: _cleanString, codePostal: _cleanString,
        surface: _cleanNumber, typeBien: (v) => _cleanEnum(v, DOSSIER_TYPE_BIEN)
    });
    if (bien) out.bien = bien;

    const acquisition = _cleanSubObject(parsed.acquisition, {
        prix: _cleanNumber, fraisNotaire: _cleanNumber, fraisAgence: _cleanNumber,
        dateAchat: _cleanString, valeurEstimee: _cleanNumber, dateEstimation: _cleanString
    });
    if (acquisition) out.acquisition = acquisition;

    const credit = _cleanSubObject(parsed.credit, {
        montant: _cleanNumber, duree: _cleanNumber, taux: _cleanNumber, assurance: _cleanNumber
    });
    if (credit) out.credit = credit;

    const charges = _cleanSubObject(parsed.charges, {
        taxeFonciere: _cleanNumber, chargesCopro: _cleanNumber,
        assurancePNO: _cleanNumber, gestionLocative: _cleanNumber
    });
    if (charges) out.charges = charges;

    const travail = _cleanSubObject(parsed.travail, {
        date: _cleanString, description: _cleanString, montant: _cleanNumber,
        tagSuggestion: (v) => _cleanEnum(v, ALLOWED_TAGS)
    });
    if (travail) out.travail = travail;

    return out;
}

exports.extraireDossierBien = onCall({ secrets: [mammouthApiKey], region: 'europe-west1', timeoutSeconds: 60 }, async (request) => {
    const { base64, mimeType } = _validateImageInput(request);

    const parsed = await _callMammouthVision({
        systemPrompt: DOSSIER_SYSTEM_PROMPT,
        userText: "Extrait les informations de ce document lié à l'achat ou la gestion d'un bien immobilier locatif.",
        base64,
        mimeType,
        logLabel: 'extraireDossierBien'
    });

    return _sanitizeDossierResult(parsed);
});
