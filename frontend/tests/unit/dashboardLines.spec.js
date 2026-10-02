import { describe, expect, it } from 'vitest';
import { DASHBOARD_HEADING, DASHBOARD_LINE_KINDS } from '@/components/molecules/IntentPreview/dashboardLines';
import { CARD_CATALOG, PERIOD_OPTIONS } from '@/plugins/dashboard/cardCatalog';

const t = (key, values) => (values ? `${key}|${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')}` : key);
const entry = CARD_CATALOG[0];
const period = PERIOD_OPTIONS.find((option) => option.id === 3);

describe('the dashboard preview heading', () => {
    it('is frozen so a caller cannot reword it', () => {
        expect(Object.isFrozen(DASHBOARD_HEADING)).toBe(true);
        expect(DASHBOARD_HEADING.kind).toBe('IntentPreview.new_dashboard_card');
    });
});

describe('the dashboard line', () => {
    const line = DASHBOARD_LINE_KINDS.dashboard;

    it('names an existing dashboard as it is', () => {
        expect(line(t, { name: 'Sales' })).toEqual({ label: 'IntentPreview.line_dashboard', text: 'Sales' });
    });

    it('says a dashboard is new only when it is flagged new', () => {
        expect(line(t, { name: 'Sales', isNew: true }).text).toBe('IntentPreview.dashboard_new|name=Sales');
        expect(line(t, { name: 'Sales', isNew: 'yes' }).text).toBe('Sales');
    });

    it('trims the name', () => {
        expect(line(t, { name: '  Q3 plan  ' }).text).toBe('Q3 plan');
    });

    it('shows right-to-left names unchanged', () => {
        expect(line(t, { name: 'لوحة المبيعات' }).text).toBe('لوحة المبيعات');
    });

    it('shows nothing without a usable name', () => {
        expect(line(t, {})).toBeNull();
        expect(line(t, { name: '   ' })).toBeNull();
        expect(line(t, { name: 42 })).toBeNull();
    });
});

describe('the card line', () => {
    const card = DASHBOARD_LINE_KINDS.card;

    it('shows the card by the title the dashboard editor uses', () => {
        expect(card(t, { card: entry.key })).toEqual({ label: 'IntentPreview.line_card', text: entry.titleKey });
    });

    it('adds the span of time when the number is one the editor offers', () => {
        const out = card(t, { card: entry.key, period: 3 });
        expect(out.text).toBe(`IntentPreview.card_over|card=${entry.titleKey},period=${period.labelKey}`);
    });

    it('leaves out a span of time the editor does not know', () => {
        expect(card(t, { card: entry.key, period: 99 }).text).toBe(entry.titleKey);
    });

    it('counts the automatic span as one the editor knows', () => {
        expect(card(t, { card: entry.key, period: 0 }).text).toContain('Dash.period_auto');
    });

    it('shows nothing for a card that is not in the catalogue', () => {
        expect(card(t, { card: 'NoSuchCard' })).toBeNull();
        expect(card(t, {})).toBeNull();
    });
});
