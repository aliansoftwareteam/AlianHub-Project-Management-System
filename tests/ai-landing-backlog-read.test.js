const { backlogRead, skillReach } = require('../frontend/src/views/Ai/backlogRead');

const task = (over = {}) => ({ _id: 't1', TaskName: 'Something', ProjectID: 'p1', tagsArray: [], ...over });

describe('backlogRead', () => {
    test('an empty backlog reads as empty rather than as zeros', () => {
        const read = backlogRead([]);
        expect(read.total).toBe(0);
        expect(read.groups).toEqual([]);
        expect(read.needsPerson).toBe(0);
    });

    test('groups open tasks by the kind of work the router would see', () => {
        const read = backlogRead([
            task({ _id: '1', TaskName: 'Audit the login contrast' }),
            task({ _id: '2', TaskName: 'Review the sprint copy' }),
            task({ _id: '3', TaskName: 'Fix 3 failing snapshot tests' }),
            task({ _id: '4', TaskName: 'Draft the release notes' }),
            task({ _id: '5', TaskName: 'Decide the pricing tiers' })
        ]);
        expect(read.total).toBe(5);
        expect(read.groups.map((g) => [g.labelKey, g.tasks.length])).toEqual([['review', 2], ['code', 1], ['write', 1]]);
        expect(read.needsPerson).toBe(1);
        expect(read.whyKeys).toEqual(['human_decision']);
    });

    test('work that needs a person is never offered as a group an agent could take', () => {
        const read = backlogRead([task({ TaskName: 'Call the vendor about the invoice' })]);
        expect(read.groups).toEqual([]);
        expect(read.people).toHaveLength(1);
    });
});

describe('skillReach', () => {
    const skills = [
        { key: 'qa-review', name: 'QA Review', requires: { code: 'public_url', needs: 'it needs a public URL to review', scope: 'task' } },
        { key: 'digest.ceo', name: 'Reporter', requires: { code: 'project_task', needs: 'it reports on a whole project', scope: 'project' } }
    ];

    test('counts only the open tasks that already carry what the skill needs', () => {
        const reach = skillReach(skills, [
            task({ _id: '1', TaskName: 'Check https://example.com/pricing' }),
            task({ _id: '2', TaskName: 'Check the pricing page' })
        ]);
        expect(reach[0].matches).toBe(1);
    });

    test('a project-scoped skill reports its scope instead of a task count it could never have', () => {
        expect(skillReach(skills, [task()])[1].matches).toBeNull();
        expect(skillReach(skills, [task()])[1].scope).toBe('project');
    });
});
