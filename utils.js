// Helpers partagés (formatage, échappement HTML, toast) — zéro dépendance sur state/nodes.
// Utilisés par main.js et owned-portfolio.js.

// [data-tooltip]/[data-tooltip-below] (styles.css) ne s'affichent qu'au survol souris (:hover /
// :focus-within) : sur écran tactile (owned.html), sans hover, ces bulles sont invisibles — trouvé
// lors de l'audit UX 2026-08-05 sur le libellé DSCR de l'onglet Calcul, partagé PC/mobile. Un seul
// listener global ajoute un canal tap (classe .tooltip-tap-open) à TOUTES les bulles existantes et
// futures, sans toucher au survol souris ni ajouter le moindre élément visuel.
document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-tooltip], [data-tooltip-below]');
    const current = document.querySelector('.tooltip-tap-open');
    if (current && current !== target) current.classList.remove('tooltip-tap-open');
    if (target) target.classList.toggle('tooltip-tap-open');
});

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatMultilineText(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
}

export function showToast(message, tone = 'positive') {
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'app-toast';
    el.className = `app-toast app-toast--${tone}`;
    el.textContent = message;
    document.body.appendChild(el);
    el.getBoundingClientRect();
    el.classList.add('app-toast--visible');
    setTimeout(() => {
        el.classList.remove('app-toast--visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3000);
}

export function formatCurrency(value) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
    }).format(value);
}

export function formatPercent(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }
    return `${value.toFixed(1)} %`;
}

export function formatRatio(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }
    return value.toFixed(2);
}

export function formatSignedCurrency(value) {
    const roundedValue = Math.round(value);
    const label = formatCurrency(Math.abs(roundedValue));
    if (roundedValue > 0) {
        return `+${label}`;
    }
    if (roundedValue < 0) {
        return `-${label}`;
    }
    return label;
}

export function formatCompactCurrency(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }
    const roundedValue = Math.round(value);
    const sign = roundedValue > 0 ? '+' : (roundedValue < 0 ? '-' : '');
    const compactValue = new Intl.NumberFormat('fr-FR', {
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(Math.abs(roundedValue));
    return `${sign}${compactValue} €`;
}

export function formatPlainCurrency(value) {
    return formatCurrency(value).replace(/\u00A0/g, ' ');
}

export function formatShortDateTime(value) {
    if (!value) {
        return '—';
    }

    try {
        return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(value));
    } catch (error) {
        return '—';
    }
}

export function getMetricClass(value) {
    if (value > 0) return 'is-positive';
    if (value < 0) return 'is-negative';
    return '';
}

export function getDecisionClass(tone) {
    if (tone === 'positive') return 'is-positive';
    if (tone === 'excellent') return 'is-excellent';
    if (tone === 'watch') return 'is-watch';
    if (tone === 'negative') return 'is-negative';
    return 'is-neutral';
}

export function getRegimeLabel(regime) {
    if (regime === 'micro-foncier') return 'Micro-foncier';
    if (regime === 'sci-is') return 'SCI à l\'IS';
    return 'Foncier réel';
}

export function getTypeBienLabel(type) {
    if (type === 'maison') return 'Maison';
    if (type === 'immeuble') return 'Immeuble de rapport';
    return 'Appartement';
}

export function getChecklistTone(status) {
    if (status === 'ready') return 'positive';
    if (status === 'watch') return 'watch';
    return 'negative';
}

export function getChecklistLabel(status) {
    if (status === 'ready') return 'OK';
    if (status === 'watch') return 'A verifier';
    return 'Bloquant';
}

// Impression d'un document HTML autonome (PDF décision, dossier bancaire, rapport d'un bien) sans
// serveur : le document est injecté dans la page elle-même, dans un Shadow DOM (son CSS reste isolé
// de styles.css), puis window.print() avec document.title = nom de fichier — c'est le nom proposé
// par « Enregistrer en PDF » sur PC et par la feuille de partage sur iPhone. Une iframe cachée
// aurait été plus directe, mais sur Safari iOS imprimer une iframe imprime la page parente
// (constaté sur le rapport d'un bien, dont on généralise ici la logique). Les <script> du document
// (auto-impression héritée de l'ancienne version popup) sont retirés : c'est nous qui imprimons.
// `triggerBtnId` (optionnel) : bouton dont le libellé bascule pendant la préparation.
const PRINT_ROOT_ID = 'spark-print-root';
let _printCleanup = null;

// Dans un Shadow DOM, les sélecteurs html/body ne matchent rien : rabattus sur le conteneur .print-root.
export function cssPourShadow(css) {
    return String(css)
        .replace(/(^|[^\w.#-])html\s*,\s*body(?![\w-])/g, '$1.print-root')
        .replace(/(^|[^\w.#-])(?:html|body)(?![\w-])/g, '$1.print-root');
}

export async function openPrintDocument(documentHTML, filename, triggerBtnId = null) {
    const btn = triggerBtnId ? document.getElementById(triggerBtnId) : null;
    const originalLabel = btn ? btn.textContent : null;
    if (btn) { btn.textContent = 'Préparation…'; btn.disabled = true; }
    try {
        _printCleanup?.(); // un hôte précédent sans afterprint (navigateurs mobiles) ne doit pas s'accumuler
        const parsed = new DOMParser().parseFromString(documentHTML, 'text/html');
        parsed.querySelectorAll('script').forEach(s => s.remove());
        const css = Array.from(parsed.querySelectorAll('style')).map(s => s.textContent).join('\n');
        // @page ne s'applique pas depuis un Shadow DOM : hissé dans le document le temps de l'impression.
        const pageStyle = document.createElement('style');
        pageStyle.id = 'spark-print-page';
        pageStyle.textContent = (css.match(/@page[^{]*\{[^}]*\}/g) || []).join('\n');
        const host = document.createElement('div');
        host.id = PRINT_ROOT_ID;
        host.attachShadow({ mode: 'open' }).innerHTML =
            `<style>${cssPourShadow(css)}</style><div class="print-root ${parsed.body.className}">${parsed.body.innerHTML}</div>`;
        document.head.appendChild(pageStyle);
        document.body.appendChild(host);
        document.body.classList.add('spark-printing');
        const previousTitle = document.title;
        document.title = String(filename || 'document').replace(/\.pdf$/i, '');
        _printCleanup = () => {
            document.body.classList.remove('spark-printing');
            host.remove();
            pageStyle.remove();
            document.title = previousTitle;
            window.removeEventListener('afterprint', _printCleanup);
            _printCleanup = null;
        };
        // Pas de nettoyage sur minuteur : certains navigateurs mobiles rendent la main avant que la
        // feuille d'impression ait lu la page — retirer l'hôte trop tôt donnerait un PDF vide.
        window.addEventListener('afterprint', _printCleanup);
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
        window.print();
    } catch (err) {
        showToast(`Impression impossible : ${err.message}`, 'negative');
    } finally {
        if (btn) { btn.textContent = originalLabel; btn.disabled = false; }
    }
}
