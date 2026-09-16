import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChecklistItem, isTitledItem, parseGeneratedList } from '@/utils/parseGeneratedList';

describe('parseGeneratedList', () => {
    afterEach(() => {
        delete global.generatedListProbe;
        vi.restoreAllMocks();
    });

    it('parses a JSON array of titled items', () => {
        expect(parseGeneratedList('[{"title":"Design schema"},{"title":"Write tests"}]', isTitledItem)).toEqual({
            ok: true,
            items: [{ title: 'Design schema' }, { title: 'Write tests' }]
        });
    });

    it('parses a checklist array with ids and parent ids', () => {
        const text = '[\n  {"name":"Plan","id":1},\n  {"name":"Scope","id":2,"parentId":1},\n  {"name":"Review","id":"3","parentId":null}\n]';
        expect(parseGeneratedList(text, isChecklistItem)).toEqual({
            ok: true,
            items: [{ name: 'Plan', id: 1 }, { name: 'Scope', id: 2, parentId: 1 }, { name: 'Review', id: '3', parentId: null }]
        });
    });

    it('parses the bare-key list format the task prompts ask for', () => {
        expect(parseGeneratedList('[ {title: "Task 1: setup"}, {title: "Task 2, deploy"}, ]', isTitledItem)).toEqual({
            ok: true,
            items: [{ title: 'Task 1: setup' }, { title: 'Task 2, deploy' }]
        });
    });

    it('parses a fenced JSON block', () => {
        expect(parseGeneratedList('```json\n[{"title":"Fenced"}]\n```', isTitledItem)).toEqual({ ok: true, items: [{ title: 'Fenced' }] });
        expect(parseGeneratedList('```\n[{"name":"Plain fence","id":"a"}]\n```', isChecklistItem)).toEqual({
            ok: true,
            items: [{ name: 'Plain fence', id: 'a' }]
        });
    });

    it('rejects text that is not JSON', () => {
        expect(parseGeneratedList('Here are some tasks: design, build and ship.', isTitledItem)).toEqual({ ok: false });
        expect(parseGeneratedList('', isTitledItem)).toEqual({ ok: false });
        expect(parseGeneratedList(undefined, isTitledItem)).toEqual({ ok: false });
    });

    it('rejects JavaScript that is not JSON without running it', () => {
        const probe = vi.fn(() => [{ title: 'ran' }]);
        global.generatedListProbe = probe;
        const evalSpy = vi.spyOn(global, 'eval');

        for (const text of [
            'global.generatedListProbe()',
            '[{title: global.generatedListProbe()}]',
            '(() => global.generatedListProbe())()',
            '```js\nglobal.generatedListProbe()\n```'
        ]) {
            expect(parseGeneratedList(text, isTitledItem)).toEqual({ ok: false });
        }
        expect(probe).not.toHaveBeenCalled();
        expect(evalSpy).not.toHaveBeenCalled();
    });

    it('rejects a list of the wrong shape', () => {
        expect(parseGeneratedList('{"title":"Not a list"}', isTitledItem)).toEqual({ ok: false });
        expect(parseGeneratedList('["Design","Build"]', isTitledItem)).toEqual({ ok: false });
        expect(parseGeneratedList('[{"name":"No title"}]', isTitledItem)).toEqual({ ok: false });
        expect(parseGeneratedList('[{"title":"Fine"},null]', isTitledItem)).toEqual({ ok: false });
        expect(parseGeneratedList('[{"title":42}]', isTitledItem)).toEqual({ ok: false });
        expect(parseGeneratedList('[{"name":"No id"}]', isChecklistItem)).toEqual({ ok: false });
        expect(parseGeneratedList('[{"name":"Bad parent","id":1,"parentId":{}}]', isChecklistItem)).toEqual({ ok: false });
        expect(parseGeneratedList('[{"id":1}]', isChecklistItem)).toEqual({ ok: false });
    });
});
