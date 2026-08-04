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
