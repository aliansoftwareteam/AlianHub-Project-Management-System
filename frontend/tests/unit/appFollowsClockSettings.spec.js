/* My Settings > Time format and the workspace's date format reach every screen through one
   helper. App.vue is what tells the helper, at sign-in and whenever either one changes. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { reactive } from 'vue';

const { services, stub, live } = vi.hoisted(() => ({
    services: { apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() },
    stub: (name) => ({ default: { name, render: () => null } }),
    live: { getters: null }
}));

vi.mock('@/services', () => services);
vi.mock('vuex', () => ({
    useStore: () => ({ getters: live.getters, dispatch: vi.fn(() => Promise.resolve()), commit: vi.fn() })
}));
vi.mock('@/composable/index', () => ({ languageTranslateHelper: () => ({ selectedLanguageCode: { value: 'en' }, changeLanguage: vi.fn(() => Promise.resolve({})) }) }));
vi.mock('@/composable/commonFunction', () => ({ fcmToken: vi.fn() }));
vi.mock('@/composable/socketHelper', () => ({ socketHelper: () => ({ connectServer: vi.fn() }) }));
vi.mock('@/utils/tabSyncs.js', () => ({ tabSyncHelper: () => ({ tabSync: vi.fn() }) }));
vi.mock('@/offline', async () => {
    const { ref } = await import('vue');
    return { initOffline: vi.fn(), away: ref(false), pageUnavailable: ref(false), markAway: vi.fn() };
});
vi.mock('@/config/warmChunks', () => ({ warmWorkspaceChunks: vi.fn() }));
vi.mock('@/components/offline/OfflineBanner.vue', () => stub('OfflineBanner'));
vi.mock('@/components/organisms/Tour/TourComponet.vue', () => stub('TourCom'));
vi.mock('@/components/organisms/Shell/GlobalRail.vue', () => stub('GlobalRail'));
vi.mock('@/components/organisms/Shell/MobileTabBar.vue', () => stub('MobileTabBar'));
vi.mock('@/components/organisms/Shell/ShellPanels.vue', () => stub('ShellPanels'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue', () => stub('TaskDetailOverlay'));
vi.mock('@/views/Ai/AgentLiveStrip.vue', () => stub('AgentLiveStrip'));
vi.mock('@/components/organisms/CallOverlay/CallOverlay.vue', () => stub('CallOverlay'));
vi.mock('@/components/atom/Modal/Modal.vue', () => stub('Modal'));
vi.mock('@/components/molecules/AdvanceSearch/CommandPalette.vue', () => stub('CommandPalette'));
vi.mock('@/components/organisms/QuickCreateTask/QuickCreateTask.vue', () => stub('QuickCreateTask'));
vi.mock('@/components/molecules/AiUnavailable/AiUnavailable.vue', () => stub('AiUnavailable'));

import App from '@/App.vue';
import { clockPrefs, clockText, followClockPrefs, fullText } from '@/utils/clockText';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AT = new Date(2026, 9, 2, 14, 57);
const Page = { name: 'Page', render: () => null };

async function mountApp() {
    services.apiRequestWithoutSecure.mockImplementation(() => Promise.resolve({ data: { status: true, maintenance: false } }));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'Home', component: Page }] });
    const wrapper = mount(App, { global: { plugins: [router], stubs: { DemoBanner: true, ReviewPromptModal: true, UpgradeProcessModel: true } } });
    await flushPromises();
    return wrapper;
}

describe('App tells the time helper what the person and the workspace chose', () => {
    let consoleSpies;
    let wrapper;

    beforeEach(() => {
        consoleSpies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
        services.apiRequestWithoutCompnay.mockImplementation(() => Promise.resolve({ data: {} }));
        services.apiRequest.mockImplementation(() => Promise.resolve({ data: {} }));
        followClockPrefs();
        live.getters = reactive({ 'settings/companies': [], 'settings/rules': {}, 'settings/companyUserDetail': {}, 'users/currentUser': undefined, 'settings/companyDateFormat': {} });
    });
    afterEach(() => {
        if (wrapper) wrapper.unmount();
        wrapper = null;
        consoleSpies.forEach((spy) => spy.mockRestore());
    });

    it('24-hour time and the workspace date format, from the first screen', async () => {
        live.getters['users/currentUser'] = { _id: 'u1', Time_Format: '24' };
        live.getters['settings/companyDateFormat'] = { dateFormat: 'MM/DD/YYYY' };
        wrapper = await mountApp();

        expect(clockPrefs).toEqual({ twelveHour: false, dateFormat: 'MM/DD/YYYY' });
        expect(fullText(AT)).toBe('10/02/2026, 14:57');
    });

    it('12-hour time and a day-first date before either is known', async () => {
        wrapper = await mountApp();

        expect(clockPrefs).toEqual({ twelveHour: true, dateFormat: 'DD/MM/YYYY' });
        expect(clockText(AT)).toBe('2:57 PM');
    });

    it('a change saved in My Settings, without a reload', async () => {
        live.getters['users/currentUser'] = { _id: 'u1', Time_Format: '12' };
        wrapper = await mountApp();
        expect(clockText(AT)).toBe('2:57 PM');

        live.getters['users/currentUser'] = { _id: 'u1', Time_Format: '24' };
        await flushPromises();
        expect(clockText(AT)).toBe('14:57');

        live.getters['settings/companyDateFormat'] = { dateFormat: 'YYYY-MM-DD' };
        await flushPromises();
        expect(fullText(AT)).toBe('2026-10-02, 14:57');
    });
});

/* The screens of the eleventh hand check that showed a 24-hour clock, the browser's own format or
   the stored text to a person on 12-hour time. */
const SCREENS = [
    'views/Settings/Audit/AuditLog.vue',
    'views/Ai/AiPipeline.vue',
    'views/Ai/AiRelease.vue',
    'views/Ai/AgentSettings.vue',
    'views/Ai/AgentReportDetail.vue',
    'views/Timesheet/UserTimeSheet/UserTimesheet.vue',
    'views/TimeLog/LogTimeSheet.vue',
    'views/Inbox/Inbox.vue',
    'views/Inbox/snoozePresets.js',
    'views/OAuth/oauthShared.js',
    'views/Goals/goalFormat.js',
    'views/Goals/GoalSummary.vue',
    'views/Ai/AiQuality.vue',
    'views/Settings/ImportExport/ImportExport.vue',
    'views/Projects/TableView/TableRow.vue',
    'views/Projects/components/TaskAgentMark.vue',
    'components/organisms/WorkspaceImport/RecentImports.vue',
    'components/organisms/MainChat/MainChatMessage.vue',
    'components/organisms/MainChat/MainChatThreadFooter.vue',
    'components/organisms/TaskDetailOverlay/TaskTimeSection.vue',
    'components/molecules/ActivityLogContent/ActivityContent.vue',
    'components/molecules/Home/StatusChip.vue',
    'components/templates/ActivityLog/ActivityLog.vue',
    'composable/projects.js'
];
const OWN_CLOCK = /HH:mm|hh:mm|h:mm|["'`]lll["'`]|toLocaleTimeString|hour12\s*:/;
const BROWSER_DATE_AND_TIME = /toLocaleString\((?![\s\S]{0,300}hourCycleOption\(\))/;

describe('the screens that show a time of day', () => {
    it.each(SCREENS)('%s writes no clock of its own', (file) => {
        const source = fs.readFileSync(path.resolve(HERE, '../../src', file), 'utf8');

        expect(source).not.toMatch(OWN_CLOCK);
        expect(source).not.toMatch(BROWSER_DATE_AND_TIME);
    });

    it.each(SCREENS.filter((file) => file !== 'components/templates/ActivityLog/ActivityLog.vue'))('%s asks the one helper', (file) => {
        const source = fs.readFileSync(path.resolve(HERE, '../../src', file), 'utf8');

        expect(source).toMatch(/from ['"]@\/utils\/clockText['"]/);
    });
});
