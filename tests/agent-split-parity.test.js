// The server classifier and the frontend picker must agree on what a task is and
// what a skill needs; otherwise the plan would promise an agent the router refuses.
const F = require('../frontend/src/views/Ai/agentFit');
const S = require('../Modules/Agents/taskSplit');

const regexKey = (re) => `${re.source}//${re.flags}`;

describe('taskSplit.js mirrors agentFit.js', () => {
    it('has the same work kinds, in the same order, with the same tests', () => {
        expect(S.WORK_KINDS.length).toBe(F.WORK_KINDS.length);
        F.WORK_KINDS.forEach((kind, i) => {
            const mine = S.WORK_KINDS[i];
            expect(mine.kind).toBe(kind.kind);
            expect(mine.labelKey).toBe(kind.labelKey);
            expect(regexKey(mine.test)).toBe(regexKey(kind.test));
            expect(mine.actions || []).toEqual(kind.actions || []);
            expect(mine.skills || []).toEqual(kind.skills || []);
            expect(mine.why || null).toBe(kind.why || null);
        });
    });

    it('has the same skill input rules: codes, patterns and reasons', () => {
        expect(S.SKILL_INPUTS.length).toBe(F.SKILL_INPUTS.length);
        F.SKILL_INPUTS.forEach((rule, i) => {
            const mine = S.SKILL_INPUTS[i];
            expect(mine.code).toBe(rule.code);
            expect(regexKey(mine.match)).toBe(regexKey(rule.match));
            expect(mine.reason).toBe(rule.reason);
        });
    });

    it('decides "needs" identically for every rule across the input space', () => {
        const samples = [
            { prUrl: null, publicUrl: null, briefChars: 0 },
            { prUrl: 'https://github.com/a/b/pull/1', publicUrl: null, briefChars: 10 },
            { prUrl: null, publicUrl: 'https://example.com', briefChars: 39 },
            { prUrl: null, publicUrl: null, briefChars: 40 },
            { prUrl: 'x', publicUrl: 'y', briefChars: 400 },
        ];
        F.SKILL_INPUTS.forEach((rule, i) => samples.forEach((s) => expect(S.SKILL_INPUTS[i].needs(s)).toBe(rule.needs(s))));
    });

    it('classifies the same tasks the same way', () => {
        const tasks = [
            { TaskName: 'Decide the pricing tiers' },
            { TaskName: 'Call the vendor about the SLA' },
            { TaskName: 'Fix the failing checkout test' },
            { TaskName: 'Audit the landing page for contrast' },
            { TaskName: 'Write the release notes' },
            { TaskName: 'Break down the onboarding epic' },
            { TaskName: 'Something else entirely' },
            { TaskName: 'x', rawDescription: 'please review the copy' },
            { TaskName: 'x', tagsArray: ['bug'] },
        ];
        tasks.forEach((t) => {
            const a = F.classifyTask(t);
            const b = S.classifyTask(t);
            expect(b.kind).toBe(a.kind);
            expect(b.needsPerson).toBe(a.needsPerson);
            expect(b.actions).toEqual(a.actions);
            expect(b.skills).toEqual(a.skills);
        });
    });

    it('sees the same inputs on a task as the picker does', () => {
        const { inputsOf } = require('../Modules/Agents/taskInputs');
        const tasks = [
            { TaskName: 'Review https://example.com/pricing' },
            { TaskName: 'Summarise', links: [{ kind: 'pr', url: 'https://github.com/a/b/pull/7' }] },
            { TaskName: 'Plan', description: '<p>' + 'a'.repeat(60) + '</p>' },
            { TaskName: 'Local http://localhost:4000/ai' },
        ];
        tasks.forEach((t) => expect(inputsOf(t)).toEqual(F.taskInputs(t)));
    });
});
