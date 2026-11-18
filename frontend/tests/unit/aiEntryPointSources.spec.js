import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import path from 'path';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import TaskSummaryBlock from '@/components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue';
import { useTaskSummaries } from '@/views/Projects/TableView/useTaskSummaries';

const SRC = path.resolve(__dirname, '../../src');
const read = (file) => readFileSync(path.join(SRC, file), 'utf8');
const template = (file) => read(file).split('<script')[0];

describe('every AI entry point asks the one availability question', () => {
    const ENTRY_POINTS = [
        'components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue',
        'components/molecules/CheckList/CheckList.vue',
        'components/molecules/Pages/PageDocument.vue',
        'components/atom/Description/Description.vue',
        'components/molecules/TaskDetailTab/TaskDetailTab.vue',
        'components/organisms/SubTasks/SubTasks.vue',
        'components/organisms/SprinstList/SprintsList.vue',
        'components/organisms/CreateProject/CreateProjectSidebar.vue',
        'components/organisms/TaskDetailOverlay/TaskDetailPanel.vue',
        'components/organisms/Shell/navItems.js',
        'views/Pages/PageEditorView.vue',
        'views/Projects/Projects.vue',
        'views/Projects/ProjectsListing/ProjectsListPage.vue',
        'views/Projects/components/ProjectEmptyState.vue',
        'views/Projects/components/ProjectFiltersToolbar.vue',
        'views/Projects/ListView/ListBulkBar.vue',
        'components/organisms/MainChat/MainChatHeader.vue',
        'components/organisms/MainChat/MainChatComposer.vue',
        'views/Inbox/Inbox.vue'
    ];

    it.each(ENTRY_POINTS)('%s has no gate of its own', (file) => {
        const source = read(file);
        expect(source).not.toMatch(/checkApps\(\s*['"]AI['"]/);
        expect(source).not.toMatch(/\baiUsable\b/);
        expect(source).not.toMatch(/\baiOff\b/);
        expect(source).toMatch(/\b(canUseAi|aiReachable)\b/);
    });

    it.each([
        'views/Projects/ProjectsListing/ProjectsListPage.vue',
        'views/Projects/components/ProjectEmptyState.vue'
    ])('%s leaves the plan check to the one question', (file) => {
        expect(read(file)).not.toMatch(/planFeature\?\.aiPermission/);
    });

    it('AI assist in a project asks with the project and the create-task permission', () => {
        expect(read('views/Projects/Projects.vue')).toMatch(/const canAiAssist = computed\(\(\) => canUseAi\(\{ project: projectData\.value, permitted: checkPermission\('task\.task_create', projectData\.value\?\.isGlobalPermission\) === true \}\)\);/);
    });

    it('shows Ask about this doc exactly when the doc renders the rail the button focuses', () => {
        expect(template('views/Pages/PageEditorView.vue')).toMatch(/v-if="canUseAi\(\) && !viewOnly"[^>]*@click="doc && doc\.askAi\(\)"/);
        expect(template('components/molecules/Pages/PageDocument.vue')).toMatch(/<PageComposeRail\s+v-if="mode === 'edit' && canUseAi\(\) && !readOnly"/);
    });
});

describe('✦ marks only features that call a model', () => {
    it.each([
        'views/Automations/AutomationsPage.vue',
        'views/Team/TeamPage.vue'
    ])('%s does not wear the AI icon', (file) => {
        expect(template(file)).not.toMatch(/name="ai"/);
    });

    it.each([
        'views/Projects/ListView/ListView.vue',
        'views/Projects/WorkloadView/WorkloadView.vue',
        'views/Timesheet/WorkloadTimesheet/WorkloadTimesheet.vue',
        'views/Timesheet/UserTimeSheet/UserTimesheet.vue',
        'views/Projects/Reports/VelocityFlowPage.vue'
    ])('%s has no ✦ on its computed hints', (file) => {
        expect(template(file)).not.toContain('✦');
    });

    it('the table keeps ✦ on the model columns and drops it from the risk formula', () => {
        const head = template('views/Projects/TableView/TableView.vue');
        expect(head).toContain("{{ column.id === 'risk' ? '' : '✦ ' }}");
        expect(head).toContain("{ 'tv2__head-ai': column.id !== 'risk' }");
    });

    it('the gantt replan is computed, while agent proposals keep ✦', () => {
        const gantt = template('views/Projects/GanttView/GanttView.vue');
        expect(gantt).not.toMatch(/✦<\/span> \{\{ \$t\('Views\.replan'\) \}\}/);
        expect(gantt).not.toContain("✦ {{ $t('Views.replan') }}");
        expect(gantt).toContain('✦ {{ p.agentName }}');
    });

    it('model features keep ✦', () => {
        expect(template('components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue')).toContain('✦');
        expect(template('components/organisms/SubTasks/SubTasks.vue')).toContain('✦');
    });
});

describe('the task summary reads a structured signal, not English server text', () => {
    beforeEach(() => apiRequest.mockReset());

    const mountBlock = async () => {
        const wrapper = mount(TaskSummaryBlock, { props: { taskId: 'task-1', pollMs: 0 } });
        await flushPromises();
        return wrapper;
    };

    it.each(['unconfigured', 'off_instance', 'off_workspace'])('hides itself when the server says AI is %s', async (aiState) => {
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Something in any language', aiState } });
        const wrapper = await mountBlock();
        expect(wrapper.find('.ah-summary').exists()).toBe(false);
    });

    it('shows other failures as an error', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'no LLM provider configured' } });
        const wrapper = await mountBlock();
        expect(wrapper.find('.ah-summary').text()).toContain('no LLM provider configured');
    });

    it('marks the table summary column unavailable from the same signal', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Keine Antwort', aiState: 'unconfigured' } });
        const summaries = useTaskSummaries();
        const entry = await summaries.generate('task-9');
        expect(entry.state).toBe('unavailable');
        expect(summaries.isUnavailable()).toBe(true);
    });
});
