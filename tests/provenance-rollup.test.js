const R = require('../Modules/Tasks/helpers/provenanceRollup');

const HUMAN = 'u-human';
const OTHER = 'u-other';
const AGENT = 'a-claude';

const work = (actorType, actorId, hours, extra = {}) => ({ actorId, actorType, hours, viaAccount: 'workspace', ...extra });
const closed = (completion, points = 3) => ({ statusType: 'close', points, completion });
const checked = { actorId: OTHER, actorType: 'human', at: new Date() };

const allHuman = closed({ workBy: [work('human', HUMAN, 4)], checkedBy: checked, closedBy: checked }, 5);
const allAgent = closed({ workBy: [work('agent', AGENT, 2, { agentId: AGENT })], checkedBy: checked, closedBy: checked }, 3);
const mixed = closed({ workBy: [work('human', HUMAN, 1), work('agent', AGENT, 3, { agentId: AGENT })], checkedBy: checked, closedBy: checked }, 8);
const uncheckedAgent = closed({ workBy: [work('agent', AGENT, 6, { agentId: AGENT })], checkedBy: null, closedBy: checked }, 2);
const closedByPersonAfterAgent = closed({ workBy: [work('agent', AGENT, 5, { agentId: AGENT })], checkedBy: checked, closedBy: { actorId: HUMAN, actorType: 'human', at: new Date() } }, 4);

describe('patternOf', () => {
    test('all-human work is HUMAN', () => expect(R.patternOf(allHuman)).toBe('HUMAN'));
    test('all-agent work checked by a person is AGENT', () => expect(R.patternOf(allAgent)).toBe('AGENT'));
    test('both actors is MIXED', () => expect(R.patternOf(mixed)).toBe('MIXED'));
    test('agent hours with no checkedBy is UNCHECKED, not HUMAN', () => {
        expect(R.patternOf(uncheckedAgent)).toBe('UNCHECKED');
        expect(R.isHumanPattern(R.patternOf(uncheckedAgent))).toBe(false);
    });
    test('a person closing after agent work does not make it human work', () => {
        expect(R.patternOf(closedByPersonAfterAgent)).toBe('AGENT');
        expect(R.isHumanPattern(R.patternOf(closedByPersonAfterAgent))).toBe(false);
    });
    test('a task with no completion record at all reads as HUMAN', () => {
        expect(R.patternOf(closed(undefined))).toBe('HUMAN');
    });
});

describe('hoursOf', () => {
    test('splits hours by actor type', () => {
        expect(R.hoursOf(mixed)).toEqual({ human: 1, agent: 3, total: 4 });
    });
    test('no record is all zeroes', () => {
        expect(R.hoursOf({})).toEqual({ human: 0, agent: 0, total: 0 });
    });
});

describe('velocitySplit', () => {
    const split = R.velocitySplit([allHuman, allAgent, mixed, uncheckedAgent, closedByPersonAfterAgent]);

    test('only human-only tasks land on the human line', () => {
        expect(split.completedHuman).toBe(5);
        expect(split.tasksHuman).toBe(1);
    });
    test('agent, mixed and unchecked all land on the agent line', () => {
        expect(split.completedAgent).toBe(3 + 8 + 2 + 4);
        expect(split.tasksAgent).toBe(4);
    });
    test('the two lines always sum to the total', () => {
        expect(split.completedHuman + split.completedAgent).toBe(split.completed);
        expect(split.completed).toBe(22);
        expect(split.closed).toBe(5);
    });
    test('unchecked agent work is counted and never hidden in the human bucket', () => {
        expect(split.unchecked).toBe(1);
        expect(split.byPattern.UNCHECKED.tasks).toBe(1);
        expect(split.byPattern.HUMAN.tasks).toBe(1);
    });
    test('patterns count what they should', () => {
        expect(split.byPattern.AGENT.tasks).toBe(2);
        expect(split.byPattern.MIXED.tasks).toBe(1);
    });
    test('hours are split the same way', () => {
        expect(split.hours).toEqual({ human: 5, agent: 16, total: 21 });
    });
    test('open tasks are ignored', () => {
        expect(R.velocitySplit([{ statusType: 'default_active', points: 9 }]).closed).toBe(0);
    });
    test('first-pass is measured per side', () => {
        const reopened = closed({ workBy: [work('agent', AGENT, 1, { agentId: AGENT })], checkedBy: checked, closedBy: checked, reopenCount: 2 }, 1);
        const s = R.velocitySplit([allAgent, reopened, allHuman]);
        expect(s.firstPass.agent).toMatchObject({ closed: 2, firstPass: 1, pct: 50 });
        expect(s.firstPass.human).toMatchObject({ closed: 1, firstPass: 1, pct: 100 });
    });
    test('nothing closed gives null percentages, not zeroes', () => {
        const s = R.velocitySplit([]);
        expect(s.firstPass.human.pct).toBeNull();
        expect(s.firstPass.agent.pct).toBeNull();
    });
});

describe('bySprint', () => {
    test('groups by sprint and ignores tasks from sprints not asked for', () => {
        const rows = R.bySprint([
            { ...allHuman, sprintId: 's1' },
            { ...allAgent, sprintId: 's2' },
            { ...mixed, sprintId: 's3' },
        ], ['s1', 's2']);
        expect(Object.keys(rows).sort()).toEqual(['s1', 's2']);
        expect(rows.s1.completedHuman).toBe(5);
        expect(rows.s2.completedAgent).toBe(3);
    });
});

describe('marginSplit', () => {
    const tasks = [allHuman, allAgent, mixed, uncheckedAgent];

    test('no cost rate means no cost, not a zero', () => {
        const m = R.marginSplit({ tasks, billedMinor: 100000 });
        expect(m.hasCostRate).toBe(false);
        expect(m.costMinor).toBeNull();
        expect(m.marginMinor).toBeNull();
        expect(m.costPerClosedTaskMinor).toBeNull();
    });
    test('agent hours cost the agent rate, human hours the blended rate', () => {
        const m = R.marginSplit({ tasks, blendedCostRateMinor: 10000, agentCostRateMinor: 2000, billedMinor: 300000 });
        expect(m.costMinor).toEqual({ human: 50000, agent: 22000, total: 72000 });
        expect(m.marginMinor).toBe(228000);
        expect(m.marginBp).toBe(7600);
    });
    test('agent rate defaults to the blended rate when unset', () => {
        const m = R.marginSplit({ tasks, blendedCostRateMinor: 10000, billedMinor: 0 });
        expect(m.costMinor.agent).toBe(110000);
    });
    test('cost per closed task is reported per pattern, null where there is nothing to divide', () => {
        const m = R.marginSplit({ tasks: [allHuman, uncheckedAgent], blendedCostRateMinor: 10000, agentCostRateMinor: 1000 });
        expect(m.costPerClosedTaskMinor.HUMAN).toBe(40000);
        expect(m.costPerClosedTaskMinor.UNCHECKED).toBe(6000);
        expect(m.costPerClosedTaskMinor.MIXED).toBeNull();
        expect(m.costPerClosedTaskMinor.all).toBe(23000);
    });
});
