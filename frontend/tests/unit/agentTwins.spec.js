import { describe, expect, it } from 'vitest';
import { twinNotes } from '@/utils/agentTwins';

describe('twinNotes', () => {
    it('shows the description of two agents that share a name', () => {
        const agents = [
            { name: 'Triage', description: 'Sorts new bugs' },
            { name: 'Triage', description: 'Sorts support mail' },
        ];
        const noteOf = twinNotes(agents);
        expect(noteOf(agents[0])).toBe('Sorts new bugs');
        expect(noteOf(agents[1])).toBe('Sorts support mail');
    });

    it('shows nothing for an agent whose name is unique', () => {
        const agents = [{ name: 'Triage', description: 'Sorts bugs' }, { name: 'Writer', description: 'Drafts docs' }];
        const noteOf = twinNotes(agents);
        expect(noteOf(agents[0])).toBe('');
        expect(noteOf(agents[1])).toBe('');
    });

    it('treats names that differ only in case or outer spaces as the same name', () => {
        const agents = [{ name: 'Triage', description: 'A' }, { name: '  triage ', description: 'B' }];
        const noteOf = twinNotes(agents);
        expect(noteOf(agents[0])).toBe('A');
        expect(noteOf(agents[1])).toBe('B');
    });

    it('trims the description and tolerates a missing one', () => {
        const agents = [{ name: 'Same', description: '  spaced  ' }, { name: 'Same' }];
        const noteOf = twinNotes(agents);
        expect(noteOf(agents[0])).toBe('spaced');
        expect(noteOf(agents[1])).toBe('');
    });

    it('copes with no agents at all', () => {
        expect(twinNotes(undefined)({ name: 'Ghost', description: 'x' })).toBe('');
        expect(twinNotes(null)({ name: 'Ghost', description: 'x' })).toBe('');
        expect(twinNotes([])({ name: 'Ghost', description: 'x' })).toBe('');
    });

    it('tells apart right-to-left names that repeat', () => {
        const agents = [{ name: 'مساعد', description: 'يفرز' }, { name: 'مساعد', description: 'يكتب' }, { name: 'עוזר', description: 'מסדר' }];
        const noteOf = twinNotes(agents);
        expect(noteOf(agents[0])).toBe('يفرز');
        expect(noteOf(agents[1])).toBe('يكتب');
        expect(noteOf(agents[2])).toBe('');
    });

    it('groups unnamed agents together instead of failing', () => {
        const agents = [{ description: 'one' }, { name: null, description: 'two' }];
        const noteOf = twinNotes(agents);
        expect(noteOf(agents[0])).toBe('one');
        expect(noteOf(agents[1])).toBe('two');
    });
});
