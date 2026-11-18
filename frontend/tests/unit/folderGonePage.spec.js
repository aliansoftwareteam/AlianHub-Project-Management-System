/* Tenth sweep, defect 10: a folder deleted in another tab leaves its open page saying so, with a way to the project
   and no "New list". */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));

import en from '@/locales/en';
import { folderIsGone } from '@/views/Projects/folderSprints';
import FolderGoneState from '@/views/Projects/components/FolderGoneState.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const PAGE = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');

const ROWS = [
    { _id: 'design', name: 'Design', projectId: 'p1', deletedStatusKey: 0 },
    { _id: 'icons', name: 'Icons', projectId: 'p1', deletedStatusKey: 0, parentFolderId: 'design' },
    { _id: 'old', name: 'Old', projectId: 'p1', deletedStatusKey: 2 },
    { _id: 'binned', name: 'Binned', projectId: 'p1', deletedStatusKey: 1 },
    { _id: 'lost', name: 'Lost', projectId: 'p1', deletedStatusKey: 0, parentFolderId: 'binned' }
];

describe('a folder that is gone', () => {
    it('is one the project no longer lists', () => {
        expect(folderIsGone(ROWS, 'never')).toBe(true);
        expect(folderIsGone([], 'design')).toBe(true);
    });

    it('is one in the trash, and a subfolder of one', () => {
        expect(folderIsGone(ROWS, 'binned')).toBe(true);
        expect(folderIsGone(ROWS, 'lost')).toBe(true);
    });

    it('is not a live folder, a live subfolder or an archived folder', () => {
        expect(folderIsGone(ROWS, 'design')).toBe(false);
        expect(folderIsGone(ROWS, 'icons')).toBe(false);
        expect(folderIsGone(ROWS, 'old')).toBe(false);
    });

    it('is not said before the project\'s folders are read, nor on a page that names no folder', () => {
        expect(folderIsGone(null, 'design')).toBe(false);
        expect(folderIsGone(undefined, 'design')).toBe(false);
        expect(folderIsGone(ROWS, '')).toBe(false);
    });
});

describe('the page of a folder that is gone', () => {
    const show = () => mount(FolderGoneState, { props: { project: { _id: 'p1', ProjectName: 'Alpha' } }, global: { stubs: { EmptyIllustration: true } } });

    it('says the folder is gone and offers the project, by its name', async () => {
        const wrapper = show();
        expect(wrapper.text()).toContain(en.EmptyState.folder_gone_title);
        expect(wrapper.text()).toContain(en.EmptyState.folder_gone_msg);
        const button = wrapper.get('button');
        expect(button.text()).toBe('Open Alpha');
        await button.trigger('click');
        expect(wrapper.emitted('open')).toHaveLength(1);
        wrapper.unmount();
    });

    it('offers no new list', () => {
        const wrapper = show();
        expect(wrapper.text()).not.toContain(en.Projects.new_list);
        wrapper.unmount();
    });

    it('stands in place of the empty folder and of the task views on the project page', () => {
        const gone = PAGE.indexOf('<FolderGoneState');
        const empty = PAGE.indexOf('<FolderEmptyState');
        expect(gone).toBeGreaterThan(-1);
        expect(gone).toBeLessThan(empty);
        expect(PAGE.slice(gone, empty)).toMatch(/v-if="folderGone"/);
        expect(PAGE.slice(empty, empty + 200)).toMatch(/v-else-if="folderWithNoLists"/);
        expect(PAGE).toMatch(/folderIsGone\(getters\['projectData\/folders'\]\?\.\[/);
    });
});
