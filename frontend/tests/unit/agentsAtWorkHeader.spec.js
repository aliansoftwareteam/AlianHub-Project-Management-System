/* Task 047, T-5: the project header counts the agents at work, from the same lists that mark a task as worked on,
   and opens those tasks. A project where agents are paused says so. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createStore } from 'vuex';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn((method) => Promise.resolve({ data: method === 'get' ? { status: true, data: [] } : { status: true } })) }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/store/index', () => ({ default: { getters: { 'settings/companyUserDetail': {}, 'settings/rules': {}, 'settings/projectRules': {} } } }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: vi.fn() }));

import ProjectHeader from '@/views/Projects/components/ProjectHeader.vue';
import { heldTasks, openRuns } from '@/views/Ai/agentFeed';
import { agentTaskIds, agentWorkCountIn } from '@/views/Projects/composables/agentWork';
import en from '@/locales/en';

const PROJECTS = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
const CSS = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/components/project-header.css'), 'utf8');
const SINCE = '2026-10-02T08:42:00.000Z';
const claim = (taskId, projectId = 'p1') => ({ taskId, projectId, name: 'Claude, for Priya', since: SINCE });
const run = (taskId, over = {}) => ({ _id: `r-${taskId}`, agentId: 'a1', agentName: 'Reviewer', status: 'running', taskId, projectId: 'p1', startedAt: SINCE, ...over });
const blank = { render: () => null };
const project = { _id: 'p1', ProjectName: 'Alpha', ProjectCode: 'AL' };

const open = async (props = {}) => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:cid/project/:id/p', name: 'Project', component: blank }] });
    await router.push({ name: 'Project', params: { cid: 'company-1', id: 'p1' } });
    await router.isReady();
    const wrapper = mount(ProjectHeader, {
        props: { project, projects: [project], sprint: null, ...props },
        global: { plugins: [router, createStore({ getters: { 'projectData/sprints': () => ({}), 'projectData/folders': () => ({}) } })] },
    });
    await flushPromises();
    return wrapper;
};
const chip = (wrapper) => wrapper.find('[data-test="agents-at-work"]');

beforeEach(() => {
    heldTasks.value = [];
    openRuns.value = [];
});

describe('how many agents are at work in a project', () => {
    it('is the number of its tasks marked as worked on now', () => {
        heldTasks.value = [claim('t1'), claim('t2'), claim('t9', 'p2')];
        openRuns.value = [run('t2'), run('t3'), run('t4', { status: 'waiting_approval' }), run('t8', { projectId: 'p2' }), run(null)];
        expect(agentWorkCountIn('p1')).toBe(3);
        expect(agentWorkCountIn('p2')).toBe(2);
        expect(agentWorkCountIn('p3')).toBe(0);
        expect(agentWorkCountIn('')).toBe(0);
        expect(agentWorkCountIn('p1') + agentWorkCountIn('p2')).toBe(agentTaskIds.value.length);
    });

    it('follows the lists as agents take and finish work', () => {
        heldTasks.value = [claim('t1')];
        expect(agentWorkCountIn('p1')).toBe(1);
        heldTasks.value = [];
        expect(agentWorkCountIn('p1')).toBe(0);
    });
});

describe('the count in the project header', () => {
    it('is not shown while no agent is at work', async () => {
        const wrapper = await open({ agentsAtWork: 0, agentSummary: { agents: 1, running: 0, waitingApproval: 1, elapsedMs: 0, spendUsd: 0 } });
        expect(chip(wrapper).exists()).toBe(false);
        expect(wrapper.find('[data-test="agents-paused"]').exists()).toBe(false);
    });

    it('is a button that names the count and opens the tasks agents are working on', async () => {
        const wrapper = await open({ agentsAtWork: 2 });
        expect(chip(wrapper).element.tagName).toBe('BUTTON');
        expect(chip(wrapper).attributes('type')).toBe('button');
        expect(chip(wrapper).text()).toContain('AgentWork.at_work');
        expect(chip(wrapper).attributes('title')).toBe('AgentWork.at_work_open');
        await chip(wrapper).trigger('click');
        expect(wrapper.emitted('show-agent-work')).toHaveLength(1);
    });

    it('keeps the time and spend of the in-product runs beside the count', async () => {
        const wrapper = await open({ agentsAtWork: 1, agentSummary: { agents: 1, running: 1, elapsedMs: 180000, spendUsd: 0.5 } });
        expect(wrapper.find('.ph2__agents-meta').text()).toBe('3m · $0.50');
        const connectedOnly = await open({ agentsAtWork: 1, agentSummary: { agents: 0, running: 0, elapsedMs: 0, spendUsd: 0 } });
        expect(connectedOnly.find('.ph2__agents-meta').exists()).toBe(false);
    });

    it('says that agents are paused in the project', async () => {
        const wrapper = await open({ agentsAtWork: 0, agentsPaused: true });
        expect(wrapper.find('[data-test="agents-paused"]').text()).toBe('AgentWork.paused');
        expect(chip(wrapper).exists()).toBe(false);
    });

    it('is wired to the lists that mark the tasks, the project\'s pause and the "agent working" filter', () => {
        expect(PROJECTS).toMatch(/:agentsAtWork="agentWorkCountIn\(projectData\?\._id\)"/);
        expect(PROJECTS).toMatch(/:agentsPaused="projectData\?\.agentLimits\?\.paused === true"/);
        expect(PROJECTS).toMatch(/@show-agent-work="setAgentWorking\(true\)"/);
    });

    it('has its words in the English locale, a focus ring and no fixed colours', () => {
        ['at_work', 'at_work_open', 'paused'].forEach((key) => expect(en.AgentWork[key], key).toEqual(expect.any(String)));
        expect(en.AgentWork.at_work).toContain('|');
        const rules = CSS.slice(CSS.indexOf('.ph2__agents'), CSS.indexOf('@media (max-width: 1279px)'));
        expect(rules).toMatch(/button\.ph2__agents:focus-visible\s*\{[^}]*var\(--focus\)/);
        expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
});
