const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
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

// Extraction IA d'une facture/devis (PDF ou photo) pour pré-remplir le formulaire d'ajout
// d'un frais dans l'onglet Travaux (owned-portfolio.js, renderOwnedTravauxTab). Appelée à
// l'identique depuis index.html (PC) et owned.html (mobile) — voir spec
// docs/superpowers/specs/2026-08-04-onglet-travaux-refonte.md.
exports.extraireFraisFacture = onCall({ secrets: [anthropicApiKey], region: 'europe-west1', timeoutSeconds: 60 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { base64, mimeType } = request.data || {};
    if (!base64 || typeof base64 !== 'string') {
        throw new HttpsError('invalid-argument', 'Fichier manquant');
    }
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        throw new HttpsError('invalid-argument', 'Format non supporté (PDF, JPG ou PNG uniquement)');
    }

    const contentBlock = mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };

    let response;
    try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': anthropicApiKey.value(),
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 512,
                system: SYSTEM_PROMPT,
                messages: [{
                    role: 'user',
                    content: [contentBlock, { type: 'text', text: 'Extrait les informations de cette facture/devis de travaux.' }]
                }]
            })
        });
    } catch (err) {
        logger.error('extraireFraisFacture: fetch failed', { message: err?.message, stack: err?.stack });
        throw new HttpsError('unavailable', 'Impossible de contacter le service IA');
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '<unreadable>');
        logger.error('extraireFraisFacture: Anthropic API error', { status: response.status, body: errorBody, mimeType });
        throw new HttpsError('internal', `Erreur IA (${response.status})`);
    }

    const data = await response.json();
    const raw = data?.content?.[0]?.text?.trim();
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
