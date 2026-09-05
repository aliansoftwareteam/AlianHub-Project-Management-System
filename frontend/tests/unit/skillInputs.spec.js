import { describe, expect, it } from 'vitest';
import { requirementOf, requirementsOf, skillKeyOf, REQUIREMENT_CODES } from '@/views/Ai/skillInputs';

describe('skillInputs', () => {
    it('reads a skill key from a string or an object', () => {
        expect(skillKeyOf('qa-review')).toBe('qa-review');
        expect(skillKeyOf({ key: 'pr.summary', name: 'Reviewer' })).toBe('pr.summary');
        expect(skillKeyOf({ name: 'brief.parse' })).toBe('brief.parse');
        expect(skillKeyOf(null)).toBe('');
    });

    it('names the input each executable skill needs', () => {
        expect(requirementOf('qa-review')).toBe('public_url');
        expect(requirementOf('pr.summary')).toBe('pr_link');
        expect(requirementOf('risk.flags')).toBe('pr_link');
        expect(requirementOf({ key: 'brief.parse' })).toBe('brief');
        expect(requirementOf('project.plan')).toBe('brief');
        expect(requirementOf('digest.ceo')).toBe('project_task');
        expect(requirementOf('risk.today')).toBe('project_task');
    });

    it('falls back to "a task" for a skill it does not know', () => {
        expect(requirementOf('something.new')).toBe('task');
        expect(requirementOf(undefined)).toBe('task');
    });

    it('lists distinct requirements for an agent, skipping disabled skills', () => {
        const agent = { skills: [{ key: 'pr.summary' }, { key: 'risk.flags' }, { key: 'qa-review', enabled: false }, 'brief.parse'] };
        expect(requirementsOf(agent)).toEqual(['pr_link', 'brief']);
        expect(requirementsOf({})).toEqual([]);
    });

    it('only ever yields codes the locale has a line for', () => {
        expect(REQUIREMENT_CODES).toEqual(expect.arrayContaining(['public_url', 'pr_link', 'brief', 'project_task']));
        REQUIREMENT_CODES.forEach((code) => expect(code).toMatch(/^[a-z_]+$/));
    });
});
