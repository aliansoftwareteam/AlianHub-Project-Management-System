import { describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { answer } = vi.hoisted(() => ({ answer: { total: 0, projects: [] } }));
vi.mock('@/services', () => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: { status: true, data: { statuses: [], scope: 'self', ...answer } } }))
}));

import en from '@/locales/en.js';
import TasksByStatusCard from '@/components/organisms/TasksByStatusCard/TasksByStatusCard.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const locales = Object.entries(import.meta.glob('@/locales/*.js', { eager: true }))
    .map(([file, module]) => [file.split('/').pop().replace('.js', ''), module.default])
    .filter(([code, messages]) => !['en', 'main'].includes(code) && messages && typeof messages === 'object');

const read = (messages, [namespace, key]) => messages?.[namespace]?.[key];

/* Each names a list: the place a task is created in or moved to, or the list being made. */
const LIST_KEYS = [
    ['PlaceHolder', 'Enter_sprint_name', 'Enter sprint name'],
    ['Toast', 'Sprint created successfully', 'Sprint created successfully'],
    ['Toast', 'Sprint updated successfully', 'Sprint updated successfully'],
    ['Toast', 'Sprint_already_exists', 'Sprint already exists'],
    ['Chat', 'sprint', 'Sprint'],
    ['Chat', 'select_sprint', 'Select a sprint'],
    ['Chat', 'pick_both', 'Pick a project and a sprint.'],
    ['TalkToText', 'sprint', 'Sprint'],
    ['TalkToText', 'select_sprint', 'Select a sprint'],
    ['Notepad', 'select_sprint', 'Sprint'],
    ['Notepad', 'select_sprint_placeholder', 'Select a sprint'],
    ['Notepad', 'loading_sprints', 'Loading sprints…'],
    ['Notepad', 'select_sprint_required', 'Please select a sprint.'],
    ['List', 'sprint', 'Sprint'],
];
const FOLDER_KEY = ['PlaceHolder', 'Enter_directory_name', 'Enter directory name'];

describe('a list is called a list', () => {
    it.each(LIST_KEYS)('%s.%s says list, not sprint', (namespace, key) => {
        const text = read(en, [namespace, key]);
        expect(text).toMatch(/list/i);
        expect(text).not.toMatch(/sprint/i);
    });

    it('asks for a folder name, not a directory name', () => {
        expect(read(en, FOLDER_KEY)).toBe('Enter folder name');
    });

    it('leaves no locale on the old English sentence', () => {
        const stale = locales.flatMap(([code, messages]) => [...LIST_KEYS, FOLDER_KEY]
            .filter(([namespace, key, old]) => read(messages, [namespace, key]) === old)
            .map(([namespace, key]) => `${code}: ${namespace}.${key}`));
        expect(locales.length).toBeGreaterThan(5);
        expect(stale).toEqual([]);
    });
});

describe('the tasks by status card', () => {
    const subOf = async (total, projectCount) => {
        answer.total = total;
        answer.projects = Array.from({ length: projectCount }, (_, n) => ({ projectId: `p${n}`, name: `Project ${n}`, total: 1, counts: {} }));
        const wrapper = mount(TasksByStatusCard);
        await flushPromises();
        return `${wrapper.get('.dc-num').text()} ${wrapper.get('.dc-sub').text()}`;
    };

    it('counts one project as a project and one task as a task', async () => {
        expect(await subOf(2, 1)).toBe('2 tasks across 1 project');
        expect(await subOf(1, 1)).toBe('1 task across 1 project');
        expect(await subOf(7, 3)).toBe('7 tasks across 3 projects');
    });
});
