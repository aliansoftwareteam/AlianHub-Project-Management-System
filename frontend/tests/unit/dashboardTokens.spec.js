/* Dashboards (the hub, one dashboard's grid, the card shell, the card bodies, the picker and the
   settings form), read from the stylesheets: every size follows the look, the classic look still
   computes the sizes it had, and the chart and the grid take their colours and gap from tokens. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import BurndownCard from '@/components/organisms/BurndownCard/BurndownCard.vue';
import { burndownCardOptions } from '@/components/organisms/BurndownCard/burndownCardOptions';
import { burndownOptions } from '@/views/Projects/Reports/composables/agileReports';
import { readChartTokens } from '@/utils/chartTokens';
import { readLookLength } from '@/utils/lookTokens';
import { ApexChart, mountInShell } from '../cardInShell';
import {
    ENV, LEGACY_CLASS, LOOKS, classesIn, declared, fixedFontSizes, hexColours, inkThreeText, literalColours,
    onPhone, px, read, size, templateOf, text, unsetWithoutFallback, within,
} from '../tokenSheets';

enableAutoUnmount(afterEach);

const DASH = 'views/Dashboards/style.css';
const VIEW = 'views/Dashboards/DashboardView.vue';
const HUB = 'views/Dashboards/DashboardsHub.vue';
const PICKER = 'views/Dashboards/CardPicker.vue';
const SETTINGS = 'views/Dashboards/CardSettings.vue';
const SHELL = 'components/organisms/DashboardCard/DashboardCard.vue';
const BODY = 'components/organisms/DashboardCard/cardBody.css';
const card = (name) => `components/organisms/${name}/${name}.vue`;
const CARDS = ['DueSoonCard', 'MyTimeCard', 'ProjectPulseCard', 'TeamLoggedVsEtaCard', 'FreeResourcesCard', 'AtRiskTodayCard',
    'AgentSpendCard', 'TasksByStatusCard', 'BurndownCard', 'VelocityCard', 'AskAQuestionCard'].map(card);
const CONVERTED = [DASH, SHELL, BODY, PICKER, SETTINGS, ...CARDS];
const TABLET = '(max-width: 768px)';

describe('the dashboard stylesheets', () => {
    it.each(CONVERTED)('%s names no hex colour', (rel) => {
        expect(hexColours(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s paints from the colour tokens, but for a dialog scrim', (rel) => {
        expect(literalColours(rel, { scrims: ['.dash__modal', '.dpick'] })).toEqual([]);
    });

    it.each(CONVERTED)('%s sets no font size a look cannot change', (rel) => {
        expect(fixedFontSizes(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s reads no token the classic look un-sets without a fallback', (rel) => {
        expect(unsetWithoutFallback(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s never sets text in --ink-3', (rel) => {
        expect(inkThreeText(rel)).toEqual([]);
    });

    it.each([VIEW, HUB, PICKER, SETTINGS, SHELL, ...CARDS])('%s carries no legacy size or colour class', (rel) => {
        expect(classesIn(templateOf(rel)).filter((name) => LEGACY_CLASS.test(name))).toEqual([]);
    });

    it('every card in the registry is covered', () => {
        const registry = read('plugins/dashboard/cardRegistry.js');
        const registered = [...registry.matchAll(/@\/(components\/organisms\/\w+\/\w+\.vue)/g)].map((m) => m[1]);
        expect(registered.length).toBeGreaterThan(10);
        expect(registered.filter((rel) => !CARDS.includes(rel))).toEqual([]);
    });
});

describe('dashboards read the tokens', () => {
    it.each([
        [SHELL, '.dcard', 'border-radius', 'var(--r-card)'],
        [SHELL, '.dcard__head', 'padding', 'var(--card-pad-y, 13px) var(--card-pad-x, 15px) 0'],
        [SHELL, '.dcard__title', 'font', 'var(--text-h3)'],
        [SHELL, '.dcard__scope', 'font', 'var(--text-label)'],
        [SHELL, '.dcard__period', 'height', 'var(--control-h-sm, 24px)'],
        [SHELL, '.dcard__tool', 'width', 'var(--hit-min)'],
        [SHELL, '.dcard__tool', 'height', 'var(--hit-min)'],
        [SHELL, '.dcard__body', 'padding', 'calc(var(--sp-3) + 1px) var(--card-pad-x, 15px) var(--card-pad-y, 12px)'],
        [SHELL, '.dcard__cover', 'padding', 'calc(var(--sp-3) + 1px) var(--card-pad-x, 15px) var(--card-pad-y, 12px)'],
        [SHELL, '.dcard__foot', 'padding', 'calc(var(--sp-2) + 1px) var(--card-pad-x, 15px) var(--card-pad-y, 11px)'],
        [DASH, '.dash__toolbar', 'padding', '0 var(--page-pad-x, 24px)'],
        [DASH, '.dash__content', 'padding', 'var(--page-pad-y, 20px) var(--page-pad-x, 24px) calc(var(--page-pad-y, 20px) + 8px)'],
        [DASH, '.dash__hub-grid', 'gap', 'var(--gap-stack, 12px)'],
        [DASH, '.dash__stack', 'gap', 'var(--gap-stack, 12px)'],
        [DASH, '.dash__tile', 'padding', 'var(--card-pad-y, 12px) var(--card-pad-x, 14px)'],
        [DASH, '.dash__tile', 'border-radius', 'var(--r-card)'],
        [DASH, '.dash__modal-panel', 'border-radius', 'var(--r-modal)'],
        [BODY, '.dc-num', 'font', '600 calc(var(--fs-xl, 20px) + 6px)/1 var(--font-ui)'],
        [BODY, '.dc-stat__num', 'font', '600 var(--fs-xl, 19px)/1.1 var(--font-ui)'],
        [BODY, '.dc-item', 'font-size', 'var(--fs-md, 12.5px)'],
        [BODY, '.dc-item--click', 'min-height', 'var(--hit-min)'],
        [BODY, '.dc-item--click', 'box-sizing', 'border-box'],
        [PICKER, '.dpick__card', 'padding', 'var(--card-pad-y, 11px) var(--card-pad-x, 13px)'],
        [PICKER, '.dpick__search', 'height', 'max(var(--hit-min), var(--control-h-lg, 34px))'],
        [SETTINGS, '.csf', 'gap', 'var(--sp-6)'],
    ])('%s: %s { %s } is %s', (rel, selector, property, expected) => {
        expect(declared(rel, selector, property)).toBe(expected);
    });
});

describe('dashboards in the dense default', () => {
    it('a card is padded 10 by 12: head, body, cover and foot share the inset', () => {
        expect(text(SHELL, '.dcard__head', 'padding', 'dense')).toBe('10px 12px 0');
        expect(text(SHELL, '.dcard__body', 'padding', 'dense')).toBe('7px 12px 10px');
        expect(text(SHELL, '.dcard__cover', 'padding', 'dense')).toBe(text(SHELL, '.dcard__body', 'padding', 'dense'));
        expect(text(SHELL, '.dcard__foot', 'padding', 'dense')).toBe('5px 12px 10px');
        expect(text(SHELL, '.dcard__metric', 'padding', 'dense')).toBe('6px 12px 0');
        expect(text(DASH, '.dash__tile', 'padding', 'dense')).toBe('10px 12px');
        expect(text(PICKER, '.dpick__card', 'padding', 'dense')).toBe('10px 12px');
    });

    it('cards sit 10px apart on the hub and when stacked, on the 6px card radius', () => {
        expect(text(DASH, '.dash__hub-grid', 'gap', 'dense')).toBe('10px');
        expect(text(DASH, '.dash__stack', 'gap', 'dense')).toBe('10px');
        expect(text(SHELL, '.dcard', 'border-radius', 'dense')).toBe('6px');
    });

    it('the page uses the page padding', () => {
        expect(text(DASH, '.dash__toolbar', 'padding', 'dense')).toBe('0 16px');
        expect(text(DASH, '.dash__content', 'padding', 'dense')).toBe('12px 16px 20px');
    });

    it('a list row in a card is set in the 13px row type and small text in 11.5px', () => {
        expect(text(BODY, '.dc-item', 'font-size', 'dense')).toBe('13px');
        ['.dc-sub', '.dc-row__name', '.dc-stat__label', '.dc-legend', '.dc-note'].forEach((selector) => {
            expect(text(BODY, selector, 'font-size', 'dense'), selector).toBe('11.5px');
        });
        expect(text(SHELL, '.dcard__foot', 'font-size', 'dense')).toBe('11.5px');
        expect(text(SHELL, '.dcard__period', 'font-size', 'dense')).toBe('11.5px');
    });

    it('figures step down with the look', () => {
        expect(text(BODY, '.dc-num', 'font', 'dense')).toBe('600 23px/1 var(--font-ui)');
        expect(text(BODY, '.dc-num--mono', 'font-size', 'dense')).toBe('21px');
        expect(text(BODY, '.dc-num--sm', 'font-size', 'dense')).toBe('17px');
        expect(text(BODY, '.dc-stat__num', 'font', 'dense')).toBe('600 17px/1.1 var(--font-ui)');
        expect(text(card('MyTimeCard'), '.dc-stat__num--sm', 'font-size', 'dense')).toBe('13px');
    });

    it('the picker and the dialogs tighten', () => {
        expect(text(PICKER, '.dpick__head', 'padding', 'dense')).toBe('14px 16px');
        expect(text(PICKER, '.dpick__grid', 'gap', 'dense')).toBe('8px');
        expect(size(PICKER, '.dpick__search', 'height', 'dense')).toBe(32);
        expect(text(DASH, '.dash__modal-panel', 'padding', 'dense')).toBe('16px');
        expect(text(DASH, '.dash__modal-panel', 'border-radius', 'dense')).toBe('8px');
        expect(text(SETTINGS, '.csf', 'gap', 'dense')).toBe('12px');
    });
});

describe('dashboards in the classic look', () => {
    it.each([
        [SHELL, '.dcard__head', 'padding', '13px 15px 0'],
        [SHELL, '.dcard__head', 'gap', '7px'],
        [SHELL, '.dcard__metric', 'padding', '8px 15px 0'],
        [SHELL, '.dcard__body', 'padding', '9px 15px 12px'],
        [SHELL, '.dcard__cover', 'padding', '9px 15px 12px'],
        [SHELL, '.dcard__foot', 'padding', '7px 15px 11px'],
        [SHELL, '.dcard__foot', 'font-size', '11.5px'],
        [SHELL, '.dcard__period', 'font-size', '11.5px'],
        [SHELL, '.dcard__state', 'gap', '8px'],
        [SHELL, '.dcard__sk', 'border-radius', '5px'],
        [SHELL, '.dcard', 'border-radius', '12px'],
        [DASH, '.dash__toolbar', 'padding', '0 24px'],
        [DASH, '.dash__toolbar', 'gap', '10px'],
        [DASH, '.dash__back', 'width', '28px'],
        [DASH, '.dash__tab', 'padding', '6px 10px'],
        [DASH, '.dash__content', 'padding', '20px 24px 28px'],
        [DASH, '.dash__hub-grid', 'gap', '12px'],
        [DASH, '.dash__tile', 'gap', '9px'],
        [DASH, '.dash__tile', 'padding', '12px 14px'],
        [DASH, '.dash__preview', 'padding', '8px'],
        [DASH, '.dash__preview-item', 'padding', '3px 8px'],
        [DASH, '.dash__preview-item', 'font-size', '11.5px'],
        [DASH, '.dash__stack', 'gap', '12px'],
        [DASH, '.dash__hidden', 'margin', '14px 0 0'],
        [DASH, '.dash__modal', 'padding', '24px'],
        [DASH, '.dash__modal-panel', 'padding', '20px'],
        [DASH, '.dash__modal-panel', 'gap', '14px'],
        [DASH, '.dash__template-opt', 'gap', '9px'],
        [BODY, '.dc-body', 'gap', '9px'],
        [BODY, '.dc-num', 'font', '600 26px/1 var(--font-ui)'],
        [BODY, '.dc-num--mono', 'font-size', '24px'],
        [BODY, '.dc-num--sm', 'font-size', '20px'],
        [BODY, '.dc-sub', 'font-size', '11.5px'],
        [BODY, '.dc-stats', 'gap', '18px'],
        [BODY, '.dc-stat__num', 'font', '600 19px/1.1 var(--font-ui)'],
        [BODY, '.dc-stat__label', 'font-size', '11px'],
        [BODY, '.dc-row', 'gap', '9px'],
        [BODY, '.dc-row__name', 'font-size', '11.5px'],
        [BODY, '.dc-item', 'gap', '8px'],
        [BODY, '.dc-item', 'padding', '6px 2px'],
        [BODY, '.dc-item', 'font-size', '12.5px'],
        [BODY, '.dc-legend', 'gap', '10px'],
        [BODY, '.dc-legend', 'font-size', '11px'],
        [BODY, '.dc-note', 'padding', '8px 10px'],
        [BODY, '.dc-note', 'line-height', '1.45'],
        [PICKER, '.dpick', 'padding', '24px'],
        [PICKER, '.dpick__head', 'padding', '16px 20px'],
        [PICKER, '.dpick__head', 'gap', '10px'],
        [PICKER, '.dpick__search', 'height', '34px'],
        [PICKER, '.dpick__close', 'width', '28px'],
        [PICKER, '.dpick__body', 'padding', '16px 20px 20px'],
        [PICKER, '.dpick__body', 'gap', '20px'],
        [PICKER, '.dpick__grid', 'gap', '10px'],
        [PICKER, '.dpick__card', 'padding', '11px 13px'],
        [PICKER, '.dpick__card-answer', 'font-size', '12px'],
        [PICKER, '.dpick__foot', 'padding', '11px 20px'],
        [SETTINGS, '.csf', 'gap', '14px'],
        [card('DueSoonCard'), '.ds__due', 'font-size', '10px'],
        [card('DueSoonCard'), '.ds__due', 'padding', '2px 6px'],
        [card('MyTimeCard'), '.dc-stat__num--sm', 'font-size', '16px'],
        [card('TeamLoggedVsEtaCard'), '.tle', 'gap', '7px'],
        [card('TeamLoggedVsEtaCard'), '.tle__name', 'font-size', '11.5px'],
        [card('TeamLoggedVsEtaCard'), '.tle__name--task', 'padding-left', '20px'],
        [card('TasksByStatusCard'), '.tbs__rows', 'gap', '7px'],
        [card('TasksByStatusCard'), '.tbs__bar', 'border-radius', '4px'],
        [card('AgentSpendCard'), '.spend__rows', 'gap', '9px'],
        [card('AtRiskTodayCard'), '.risk__reason', 'font-size', '10px'],
        [card('AskAQuestionCard'), '.askc__answer', 'line-height', '1.55'],
        [card('AskAQuestionCard'), '.askc__cites', 'gap', '4px'],
    ])('%s: %s { %s } is still %s', (rel, selector, property, former) => {
        expect(text(rel, selector, property, 'classic')).toBe(former);
    });
});

describe('dashboards in the other looks', () => {
    it.each([
        ['a', '14px 16px 0', '600 26px/1 var(--font-ui)', '16px', '13px'],
        ['c', '18px 20px 0', '600 30px/1 var(--font-ui)', '20px', '14px'],
    ])('%s: card head %s, figure %s, cards %s apart, list rows %s', (look, head, figure, gap, row) => {
        expect(text(SHELL, '.dcard__head', 'padding', look)).toBe(head);
        expect(text(BODY, '.dc-num', 'font', look)).toBe(figure);
        expect(text(DASH, '.dash__hub-grid', 'gap', look)).toBe(gap);
        expect(text(BODY, '.dc-item', 'font-size', look)).toBe(row);
    });
});

describe('dashboards on a phone', () => {
    const FLOOR = px('var(--hit-min)', ENV.phone);

    it('controls that read the floor are 40px', () => {
        expect(FLOOR).toBe(40);
        [
            [SHELL, '.dcard__tool', 'width'], [SHELL, '.dcard__tool', 'height'],
            [BODY, '.dc-item--click', 'min-height'],
            [DASH, '.dash__back', 'width'], [DASH, '.dash__back', 'height'],
            [DASH, '.dash__tile-menu', 'width'], [DASH, '.dash__tile-menu', 'height'],
            [DASH, '.dash__tile-open', 'min-height'],
            [PICKER, '.dpick__close', 'width'], [PICKER, '.dpick__close', 'height'], [PICKER, '.dpick__search', 'height'],
        ].forEach(([rel, selector, property]) => {
            expect(size(rel, selector, property, 'phone'), `${selector} ${property}`).toBe(FLOOR);
        });
    });

    it('the period select, the card link and the rows a card makes clickable hold it too', () => {
        expect(px(onPhone(SHELL, '.dcard__period', 'height'), ENV.phone)).toBe(FLOOR);
        expect(px(onPhone(SHELL, '.dcard__link', 'min-height'), ENV.phone)).toBe(FLOOR);
        expect(px(onPhone(card('ProjectPulseCard'), '.ppc__bar-row', 'min-height'), ENV.phone)).toBe(FLOOR);
        expect(px(onPhone(card('TeamLoggedVsEtaCard'), '.tle__row--team', 'min-height'), ENV.phone)).toBe(FLOOR);
        expect(px(onPhone(card('AtRiskTodayCard'), '.risk__row', 'min-height'), ENV.phone)).toBe(44);
        expect(px(onPhone(card('AskAQuestionCard'), 'a.askc__ref', 'min-height'), ENV.phone)).toBe(FLOOR);
    });

    it('a hub tab keeps the 44px it had', () => {
        expect(within(DASH, TABLET, '.dash__tab', 'min-height')).toBe('44px');
    });
});

/* axe's target-size rule (WCAG 2.5.8): 24 by 24 px, or the centre 12px from every other control's edge. */
describe('dashboard controls keep a 24px target on a desktop', () => {
    it.each(LOOKS)('card tools, the period select, the tile menu and the dialog buttons are full targets in %s', (look) => {
        [
            [SHELL, '.dcard__tool', 'width'], [SHELL, '.dcard__tool', 'height'], [SHELL, '.dcard__period', 'height'],
            [BODY, '.dc-item--click', 'min-height'],
            [DASH, '.dash__back', 'width'], [DASH, '.dash__tab', 'min-height'], [DASH, '.dash__tile-menu', 'width'], [DASH, '.dash__tile-open', 'min-height'],
            [PICKER, '.dpick__close', 'width'], [PICKER, '.dpick__search', 'height'],
        ].forEach(([rel, selector, property]) => {
            expect(size(rel, selector, property, look), `${selector} ${property}`).toBeGreaterThanOrEqual(24);
        });
    });
});

describe('the burndown chart takes its colours from the theme', () => {
    const tokens = { series: ['rgb(1, 2, 3)', 'rgb(4, 5, 6)'], ink2: 'rgb(7, 8, 9)', grid: 'rgb(10, 11, 12)', surface: 'rgb(13, 14, 15)' };
    const days = [{ date: '2026-09-01' }, { date: '2026-09-02' }];
    const base = burndownOptions(days, { id: 'burndown-c1' });
    const options = burndownCardOptions(base, tokens);

    it('the series, the axis labels, the axis lines and the grid are tokens', () => {
        expect(options.colors).toEqual(['rgb(1, 2, 3)', 'transparent']);
        expect(options.xaxis.labels.style.colors).toBe('rgb(7, 8, 9)');
        expect(options.yaxis.labels.style.colors).toBe('rgb(7, 8, 9)');
        expect(options.xaxis.axisBorder.color).toBe('rgb(10, 11, 12)');
        expect(options.xaxis.axisTicks.color).toBe('rgb(10, 11, 12)');
        expect(options.grid.borderColor).toBe('rgb(10, 11, 12)');
        expect(options.markers.strokeColors).toBe('rgb(13, 14, 15)');
    });

    it('names no colour of its own, and keeps what the report set', () => {
        expect(JSON.stringify(options)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(read('components/organisms/BurndownCard/burndownCardOptions.js')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        expect(options.legend).toEqual({ show: false });
        expect(options.xaxis.categories).toEqual(['2026-09-01', '2026-09-02']);
        expect(options.xaxis.labels.rotate).toBe(base.xaxis.labels.rotate);
        expect(options.yaxis.min).toBe(0);
        expect(options.stroke).toEqual(base.stroke);
        expect(options.chart.id).toBe('burndown-c1');
    });

    it('the tooltip, the gridlines and the ideal line are painted by the report stylesheet the card loads', () => {
        const sfc = read(card('BurndownCard'));
        const sheet = read('views/Projects/Reports/reportsV2.css');
        expect(sfc).toMatch(/<style src="@\/views\/Projects\/Reports\/reportsV2\.css"><\/style>/);
        expect(sfc).toMatch(/class="rp-chart rp-chart--burndown burn__chart"/);
        expect(sheet).toMatch(/:is\(\.rp-page, \.rp-chart\) \.apexcharts-tooltip\.apexcharts-theme-light \{ background: var\(--surface\)/);
        expect(sheet).toMatch(/\.rp-chart--burndown \.apexcharts-series:nth-of-type\(2\) path \{ stroke: var\(--ink-3\)/);
    });

    describe('in the card', () => {
        const root = document.documentElement;
        const paint = (brand, ink, hairline) => {
            root.style.setProperty('--brand', brand);
            root.style.setProperty('--ink-2', ink);
            root.style.setProperty('--hairline', hairline);
        };
        const burndown = { data: { status: true, data: { sprintName: 'Sprint 4', totalPoints: 12, days: [
            { date: '2026-09-01', remainingPoints: 12, idealPoints: 12 },
            { date: '2026-09-02', remainingPoints: 7, idealPoints: 6 },
        ] } } };

        beforeEach(() => {
            apiRequest.mockReset();
            apiRequest.mockResolvedValue(burndown);
            paint('rgb(47, 57, 144)', 'rgb(90, 90, 90)', 'rgb(230, 230, 230)');
        });
        afterEach(() => {
            ['--brand', '--ink-2', '--hairline'].forEach((name) => root.style.removeProperty(name));
            root.removeAttribute('data-theme');
        });

        it('reads the tokens the page has', () => {
            expect(readChartTokens().series[0]).toBe('rgb(47, 57, 144)');
            expect(readChartTokens().ink2).toBe('rgb(90, 90, 90)');
        });

        it('hands the chart the theme colours, and reads them again when the theme changes', async () => {
            const { wrapper } = mountInShell(BurndownCard, { props: { cardData: { sprintId: 's1' } } });
            await flushPromises();
            const chart = () => wrapper.findComponent(ApexChart).props('options');
            expect(chart().colors).toEqual(['rgb(47, 57, 144)', 'transparent']);
            expect(chart().xaxis.labels.style.colors).toBe('rgb(90, 90, 90)');
            expect(chart().grid.borderColor).toBe('rgb(230, 230, 230)');

            paint('rgb(168, 146, 255)', 'rgb(200, 200, 200)', 'rgb(40, 40, 40)');
            root.setAttribute('data-theme', 'dark');
            await flushPromises();
            await nextTick();

            expect(chart().colors).toEqual(['rgb(168, 146, 255)', 'transparent']);
            expect(chart().xaxis.labels.style.colors).toBe('rgb(200, 200, 200)');
            expect(chart().grid.borderColor).toBe('rgb(40, 40, 40)');
        });
    });
});

describe('the grid gap follows the look', () => {
    it('the dashboard hands the grid the stack gap, with the former 12px as the fallback', () => {
        const sfc = read(VIEW);
        expect(sfc).toMatch(/const gridGap = useLookLength\('--gap-stack', 12\);/);
        expect(sfc).toMatch(/const gridMargin = computed\(\(\) => \[gridGap\.value, gridGap\.value\]\);/);
        expect(sfc).toMatch(/:margin="gridMargin"/);
        expect(sfc).not.toMatch(/:margin="\[/);
        expect(px('var(--gap-stack, 12px)', ENV.dense)).toBe(10);
        expect(px('var(--gap-stack, 12px)', ENV.classic)).toBe(12);
    });

    it('a length token is read from the page, and the fallback stands in where the look un-sets it', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        el.style.setProperty('--gap-stack', '10px');
        expect(readLookLength('--gap-stack', 12, el)).toBe(10);
        el.style.removeProperty('--gap-stack');
        expect(readLookLength('--gap-stack', 12, el)).toBe(12);
        el.remove();
    });
});
