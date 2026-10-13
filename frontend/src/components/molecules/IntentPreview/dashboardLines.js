// The lines of a card an agent asks to add to a dashboard (Modules/Agents/dashboardRequests.js). The server names the
// card by its component and the span of time by its number, as the dashboard stores them; the words are the
// dashboard editor's own.

import { PERIOD_OPTIONS, catalogEntry } from '@/plugins/dashboard/cardCatalog';

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

export const DASHBOARD_HEADING = Object.freeze({ kind: 'IntentPreview.new_dashboard_card', wants: 'IntentPreview.wants_dashboard_card' });

export const DASHBOARD_LINE_KINDS = {
    dashboard: (t, line) => {
        const name = textOf(line.name);
        if (!name) return null;
        return { label: t('IntentPreview.line_dashboard'), text: line.isNew === true ? t('IntentPreview.dashboard_new', { name }) : name };
    },
    card: (t, line) => {
        const entry = catalogEntry(line.card);
        if (!entry) return null;
        const period = PERIOD_OPTIONS.find((option) => option.id === line.period);
        const card = t(entry.titleKey);
        return { label: t('IntentPreview.line_card'), text: period ? t('IntentPreview.card_over', { card, period: t(period.labelKey) }) : card };
    },
};
