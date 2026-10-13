import { hourCycleOption } from '@/utils/clockText';

/* The server stores a goal's colour as #rrggbb, so the choices are values, not tokens. */
export const GOAL_COLORS = ['#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#0EA5E9', '#EC4899', '#14B8A6', '#F97316'];

/* The app's locale codes are its own (ch, ge, ptBr): one Intl does not know falls back to the browser's. */
const formatter = (Kind, locale, options) => {
    try {
        return new Kind(locale, options);
    } catch (error) {
        return new Kind(undefined, options);
    }
};

export function formatNumber(value, locale) {
    const number = Number(value);
    return Number.isFinite(number) ? formatter(Intl.NumberFormat, locale, { maximumFractionDigits: 2 }).format(number) : '';
}

function formatMoney(value, code, locale) {
    try {
        return formatter(Intl.NumberFormat, locale, { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));
    } catch (error) {
        return `${code} ${formatNumber(value, locale)}`;
    }
}

export function formatAmount(target, value, locale) {
    if (!Number.isFinite(Number(value))) return '';
    if (target.kind === 'currency' && target.currencyCode) return formatMoney(value, target.currencyCode, locale);
    const text = formatNumber(value, locale);
    return target.unit ? `${text} ${target.unit}` : text;
}

export function formatDay(day, locale) {
    const [year, month, date] = String(day || '').split('-').map(Number);
    if (!year || !month || !date) return '';
    return formatter(Intl.DateTimeFormat, locale, { dateStyle: 'medium' }).format(new Date(year, month - 1, date));
}

export function formatWhen(stamp, locale) {
    const date = new Date(stamp);
    return stamp && !Number.isNaN(date.getTime()) ? formatter(Intl.DateTimeFormat, locale, { dateStyle: 'medium', timeStyle: 'short', ...hourCycleOption() }).format(date) : '';
}

export function periodLabel(goal, t, locale) {
    const start = formatDay(goal.periodStart, locale);
    const end = formatDay(goal.periodEnd, locale);
    if (start && end) return t('Goals.period_range', { start, end });
    if (start) return t('Goals.period_from', { start });
    if (end) return t('Goals.period_until', { end });
    return t('Goals.period_none');
}
