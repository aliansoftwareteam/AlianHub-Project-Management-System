import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => services);

import { undoImportJob } from '@/components/organisms/WorkspaceImport/importUndo';

const answer = (data) => services.apiRequest.mockResolvedValue({ data });
const refused = (data, message) => services.apiRequest.mockImplementation(() => Promise.reject(Object.assign(new Error(message || 'Request failed'), { response: { data } })));

beforeEach(() => {
    services.apiRequest.mockReset();
});

describe('undoImportJob', () => {
    it('asks the job to be undone and says whether edited tasks are kept', async () => {
        answer({ status: true, data: { trashed: 4, kept: [] } });
        await undoImportJob('job1', true);
        const [method, route, body] = services.apiRequest.mock.calls[0];
        expect(method).toBe('post');
        expect(route).toMatch(/\/job1\/undo$/);
        expect(body).toEqual({ keepEdited: true });
    });

    it('reports how many tasks went to the trash', async () => {
        answer({ status: true, data: { trashed: 12, kept: [] } });
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'undone', trashed: 12, kept: [] });
    });

    it('lists the tasks that were kept', async () => {
        answer({ status: true, data: { trashed: 2, kept: ['Fix login', 'Write docs'] } });
        const result = await undoImportJob('j', true);
        expect(result.kept).toEqual(['Fix login', 'Write docs']);
    });

    it('counts a missing trashed number as zero', async () => {
        answer({ status: true, data: {} });
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'undone', trashed: 0, kept: [] });
    });

    it('holds the undo back and names the tasks someone has worked on', async () => {
        refused({ status: false, code: 'EDITED', data: { edited: ['Ship it', 'Review'], editedCount: 2 } });
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'edited', edited: ['Ship it', 'Review'], editedCount: 2 });
    });

    it('reads an edited answer that arrives as a plain 200 body', async () => {
        answer({ status: false, code: 'EDITED', data: { edited: ['A'], editedCount: 7 } });
        const result = await undoImportJob('j', false);
        expect(result).toEqual({ outcome: 'edited', edited: ['A'], editedCount: 7 });
    });

    it('defaults an edited answer with no detail to an empty list and zero', async () => {
        refused({ code: 'EDITED' });
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'edited', edited: [], editedCount: 0 });
    });

    it('calls a job that was already undone settled', async () => {
        refused({ code: 'ALREADY_UNDONE' });
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'settled' });
    });

    it('calls a job with nothing to undo settled', async () => {
        answer({ status: false, code: 'NOTHING_TO_UNDO' });
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'settled' });
    });

    it('fails with the server sentence for any other refusal', async () => {
        refused({ code: 'SOMETHING', statusText: 'Import is locked' });
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'failed', message: 'Import is locked' });
    });

    it('fails with the network message when no answer came', async () => {
        services.apiRequest.mockImplementation(() => Promise.reject(new Error('Network Error')));
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'failed', message: 'Network Error' });
    });

    it('fails with an empty message when nothing at all is known', async () => {
        answer(undefined);
        expect(await undoImportJob('j', false)).toEqual({ outcome: 'failed', message: '' });
    });
});
