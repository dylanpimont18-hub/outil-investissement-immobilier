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
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { base64, mimeType } = request.data || {};
    if (!base64 || typeof base64 !== 'string') {
        throw new HttpsError('invalid-argument', 'Fichier manquant');
    }
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        throw new HttpsError('invalid-argument', 'Format non supporté (JPG ou PNG uniquement)');
    }

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
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                            { type: 'text', text: 'Extrait les informations de cette facture/devis de travaux.' }
                        ]
                    }
                ]
            })
        });
    } catch (err) {
        logger.error('extraireFraisFacture: fetch failed', { message: err?.message, stack: err?.stack });
        throw new HttpsError('unavailable', 'Impossible de contacter le service IA');
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '<unreadable>');
        logger.error('extraireFraisFacture: Mammouth API error', { status: response.status, body: errorBody, mimeType });
        throw new HttpsError('internal', `Erreur IA (${response.status})`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        logger.error('extraireFraisFacture: unparseable response', { raw, message: err?.message });
        throw new HttpsError('internal', 'Réponse IA non exploitable');
    }

    return {
        date: typeof parsed.date === 'string' ? parsed.date : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        montant: Number(parsed.montant) || 0,
        tagSuggestion: ALLOWED_TAGS.includes(parsed.tagSuggestion) ? parsed.tagSuggestion : 'a-classifier',
        confiance: ALLOWED_CONFIANCE.includes(parsed.confiance) ? parsed.confiance : 'basse'
    };
});
