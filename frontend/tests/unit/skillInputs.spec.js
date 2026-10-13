import { describe, expect, it } from 'vitest';
import { requirementOf, requirementsOf, skillKeyOf, indexSkills, REQUIREMENT_CODES } from '@/views/Ai/skillInputs';

// The manifest as GET /api/v2/agents/skills sends it. Nothing in the frontend
// decides which skill needs which input any more; this is the only source.
const requires = (code, scope = 'task') => ({ code, needs: `it needs ${code}`, scope });
const MANIFEST = [
    { key: 'qa-review', aliases: [], inputs: ['public_url'], requires: requires('public_url') },
    { key: 'pr.summary', aliases: ['risk.flags'], inputs: ['pr_link'], requires: requires('pr_link') },
    { key: 'brief.parse', aliases: ['project.plan'], inputs: ['brief'], requires: requires('brief') },
    { key: 'digest.ceo', aliases: ['risk.today'], inputs: ['project_task'], requires: requires('project_task', 'project') }
];
const index = indexSkills(MANIFEST);

describe('skillInputs', () => {
    it('reads a skill key from a string or an object', () => {
        expect(skillKeyOf('qa-review')).toBe('qa-review');
        expect(skillKeyOf({ key: 'pr.summary', name: 'Reviewer' })).toBe('pr.summary');
        expect(skillKeyOf({ name: 'brief.parse' })).toBe('brief.parse');
        expect(skillKeyOf(null)).toBe('');
    });

    it('names the input each skill needs from the manifest, aliases included', () => {
        expect(requirementOf('qa-review', index)).toBe('public_url');
        expect(requirementOf('pr.summary', index)).toBe('pr_link');
        expect(requirementOf('risk.flags', index)).toBe('pr_link');
        expect(requirementOf({ key: 'brief.parse' }, index)).toBe('brief');
        expect(requirementOf('project.plan', index)).toBe('brief');
        expect(requirementOf('digest.ceo', index)).toBe('project_task');
        expect(requirementOf('risk.today', index)).toBe('project_task');
    });

    it('takes the requirement the server already answered on the skill itself', () => {
        expect(requirementOf({ key: 'anything', requires: requires('linked_doc') })).toBe('linked_doc');
        expect(requirementOf({ key: 'qa-review', requires: null }, index)).toBe('task');
    });

    it('falls back to "a task" for a skill the manifest does not name', () => {
        expect(requirementOf('something.new', index)).toBe('task');
        expect(requirementOf(undefined, index)).toBe('task');
        expect(requirementOf('qa-review')).toBe('task');
    });

    it('lists distinct requirements for an agent, skipping disabled skills', () => {
        const agent = { skills: [{ key: 'pr.summary' }, { key: 'risk.flags' }, { key: 'qa-review', enabled: false }, 'brief.parse'] };
        expect(requirementsOf(agent, index)).toEqual(['pr_link', 'brief']);
        expect(requirementsOf({}, index)).toEqual([]);
    });

    it('only ever yields codes the locale has a line for', () => {
        expect(REQUIREMENT_CODES).toEqual(expect.arrayContaining(['public_url', 'pr_link', 'brief', 'project_task', 'linked_doc']));
        REQUIREMENT_CODES.forEach((code) => expect(code).toMatch(/^[a-z_]+$/));
    });
});
