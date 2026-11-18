/* The four task types every company starts with name an image the company's storage is seeded with
   once. Where those files are not on disk every icon was a signed URL and then a 404, on each task
   panel and each row of a type list. The app ships the same four images, so it shows them itself. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import path from 'path';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));

import TaskTypeIcon from '@/components/atom/TaskTypeIcon/TaskTypeIcon.vue';
import WasabiImage from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import { bundledTaskTypeImage } from '@/utils/taskTypeImages';

const REPO = path.resolve(__dirname, '../../..');
const SEEDED = ['task', 'bug', 'subtask', 'design'];
const seededPath = (name) => `setting/task_type/${name}.png`;

const mounted = [];
const icon = async (taskType) => {
    const wrapper = mount(TaskTypeIcon, { props: { taskType }, global: { provide: { $defaultUserAvatar: '' } } });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: { url: 'http://localhost:4000/api/v1/download/company-1/uploaded.png?token=t' } });
});
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

describe('a default task type', () => {
    it.each(SEEDED)('shows the bundled %s icon without asking the server for it', async (name) => {
        const wrapper = await icon({ key: 1, name: 'Task', taskImage: seededPath(name) });
        const image = wrapper.find('img');
        expect(image.exists()).toBe(true);
        expect(image.attributes('src')).toContain(`task_type/${name}.png`);
        expect(image.attributes('alt')).toBe('Task');
        expect(wrapper.findComponent(WasabiImage).exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('keeps the box and the name every other icon has', async () => {
        const wrapper = await icon({ key: 2, name: 'Bug', taskImage: seededPath('bug') });
        expect(wrapper.find('img').classes()).toContain('tticon__box');
        expect(wrapper.find('.tticon').attributes('title')).toBe('Bug');
    });

    it('ships the same four images the storage seed copies', () => {
        SEEDED.forEach((name) => {
            const bundled = readFileSync(path.join(REPO, 'frontend/src/assets/images/task_type', `${name}.png`));
            const seed = readFileSync(path.join(REPO, 'wasabiUploadsLocal', `${name}.png`));
            expect(bundled.equals(seed), name).toBe(true);
        });
        const seedCode = readFileSync(path.join(REPO, 'Modules/storage/server/helpers/bucket.helper.js'), 'utf8');
        const seeded = [...seedCode.matchAll(/path:'setting\/task_type\/(\w+)\.png'/g)].map(([, name]) => name).sort();
        expect(seeded).toEqual([...SEEDED].sort());
    });
});

describe('every other icon is read as before', () => {
    it('an uploaded image is asked of storage', async () => {
        const wrapper = await icon({ key: 9, name: 'Research', taskImage: 'setting/task_type/1759312345678_research.png' });
        expect(wrapper.findComponent(WasabiImage).exists()).toBe(true);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('a full URL is used as it is', async () => {
        const wrapper = await icon({ key: 9, name: 'Research', taskImage: 'https://cdn.example.com/setting/task_type/task.png' });
        expect(wrapper.find('img').attributes('src')).toBe('https://cdn.example.com/setting/task_type/task.png');
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('a library icon wins over the image path it keeps as a fallback', async () => {
        const wrapper = await icon({ key: 9, name: 'Research', iconType: 'library', iconValue: 'mdi:flask', taskImage: seededPath('task') });
        expect(wrapper.find('.tticon--lib').exists()).toBe(true);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('which paths are bundled', () => {
    it('only the seeded four, whole path and nothing around it', () => {
        SEEDED.forEach((name) => expect(bundledTaskTypeImage(seededPath(name))).toContain(`task_type/${name}.png`));
        ['', undefined, null, 'setting/task_type/other.png', 'setting/task_type/task.png.exe', 'x/setting/task_type/task.png', 'taskPriorities/priority_high.png']
            .forEach((value) => expect(bundledTaskTypeImage(value)).toBe(''));
    });
});
