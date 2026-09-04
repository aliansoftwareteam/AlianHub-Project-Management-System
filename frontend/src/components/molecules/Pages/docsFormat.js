const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(value, t, now = Date.now()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const diff = Math.max(0, now - date.getTime());
    if (diff < MINUTE) return t('Docs.just_now');
    if (diff < HOUR) return t('Docs.minutes_ago', { n: Math.floor(diff / MINUTE) });
    if (diff < DAY) return t('Docs.hours_ago', { n: Math.floor(diff / HOUR) });
    if (diff < 2 * DAY) return t('Docs.yesterday');
    if (diff < 14 * DAY) return t('Docs.days_ago', { n: Math.floor(diff / DAY) });
    return shortDate(date);
}

export function shortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function toDateInput(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function reviewChipClass(state) {
    if (state === 'verified') return 'ah-chip--ok';
    if (state === 'due') return 'ah-chip--warn';
    if (state === 'stale') return 'ah-chip--danger';
    return '';
}

export function reviewLabelKey(state) {
    if (state === 'verified') return 'Docs.verified';
    if (state === 'due') return 'Docs.due_now';
    if (state === 'stale') return 'Docs.stale';
    return 'Docs.not_reviewed';
}

export function headingsOf(editorData) {
    const blocks = (editorData && editorData.blocks) || [];
    return blocks
        .filter((b) => b && b.type === 'header' && b.data && String(b.data.text || '').trim())
        .map((b) => ({
            id: b.id || '',
            level: Number(b.data.level) || 2,
            text: String(b.data.text).replace(/<[^>]+>/g, '').trim(),
        }));
}
