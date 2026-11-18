// One project's sprints, tasks and status history for comparing the agile report
// calculations with the output captured from beta in agileReports.beta.json.
// Events sit at noon UTC so a day's counts are the same in any zone from -11 to +11.

const IDS = Object.freeze({
    COMPANY: '6f0000000000000000000c21',
    OWNER: '6f0000000000000000000021',
    MEMBER: '6f0000000000000000000022',
    OTHER: '6f0000000000000000000023',
    PROJECT: '6f0000000000000000000d21',
    EMPTY_PROJECT: '6f0000000000000000000d22',
    SPRINT_3: '6f0000000000000000000e21',
    SPRINT_4: '6f0000000000000000000e22',
    PRIVATE_SPRINT: '6f0000000000000000000e23',
    SPIKE: '6f0000000000000000000e24',
    ACTIVE_SPRINT: '6f0000000000000000000e25',
});

const MEMBER_ROLE = 3;
const at = (iso) => new Date(iso);
const human = (actorId) => ({ workBy: [{ actorId, actorType: 'human', viaAccount: 'workspace', hours: 2 }] });
const agent = (checkedBy) => ({ workBy: [{ actorId: 'a1', actorType: 'agent', agentId: 'a1', viaAccount: 'workspace', hours: 1 }], checkedBy });

const seedAgileReports = (db, SCHEMA_TYPE) => {
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: IDS.OWNER, roleType: 1, status: 2, isDelete: false });
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: IDS.MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: IDS.OTHER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: IDS.PROJECT, ProjectName: 'Launch', isPrivateSpace: false, deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: IDS.EMPTY_PROJECT, ProjectName: 'Empty', isPrivateSpace: false, deletedStatusKey: 0 });

    const sprint = (over) => ({ projectId: IDS.PROJECT, isScrum: true, state: 'closed', deletedStatusKey: 0, ...over });
    db.seed(SCHEMA_TYPE.SPRINTS, sprint({ _id: IDS.SPRINT_3, name: 'Sprint 3', startDate: at('2026-07-14T12:00:00Z'), endDate: at('2026-07-27T12:00:00Z'), commitment: { points: 8, at: at('2026-07-14T12:00:00Z') }, closeReport: { at: at('2026-07-28T12:00:00Z') } }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprint({ _id: IDS.SPRINT_4, name: 'Sprint 4', startDate: at('2026-07-28T12:00:00Z'), endDate: at('2026-08-10T12:00:00Z'), commitment: { points: 5, at: at('2026-07-28T12:00:00Z') }, closeReport: { at: at('2026-08-11T12:00:00Z') } }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprint({ _id: IDS.PRIVATE_SPRINT, name: 'Security', private: true, AssigneeUserId: [IDS.OTHER], startDate: at('2026-08-12T12:00:00Z'), endDate: at('2026-08-25T12:00:00Z'), commitment: { points: 5, at: at('2026-08-12T12:00:00Z') }, closeReport: { at: at('2026-08-26T12:00:00Z') } }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprint({ _id: IDS.SPIKE, name: 'Spike', startDate: at('2026-08-01T12:00:00Z'), endDate: at('2026-08-14T12:00:00Z'), closeReport: { at: at('2026-08-15T12:00:00Z') } }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprint({ _id: IDS.ACTIVE_SPRINT, name: 'Sprint 5', state: 'active', startDate: at('2026-08-27T12:00:00Z'), commitment: { points: 13, at: at('2026-08-27T12:00:00Z') } }));

    const task = (over) => ({ ProjectID: IDS.PROJECT, isParentTask: true, deletedStatusKey: 0, createdAt: at('2026-07-15T12:00:00Z'), updatedAt: at('2026-07-20T12:00:00Z'), ...over });
    const tasks = [
        task({ _id: '6f0000000000000000000f21', sprintId: IDS.SPRINT_3, statusType: 'close', points: 5, completion: human(IDS.MEMBER) }),
        task({ _id: '6f0000000000000000000f22', sprintId: IDS.SPRINT_3, statusType: 'close', points: 2, completion: agent({ actorId: IDS.OWNER }) }),
        task({ _id: '6f0000000000000000000f23', sprintId: IDS.SPRINT_4, statusType: 'close', points: 3, completion: agent(null), createdAt: at('2026-07-29T12:00:00Z'), updatedAt: at('2026-08-09T12:00:00Z') }),
        task({ _id: '6f0000000000000000000f24', sprintId: IDS.SPRINT_4, statusType: 'inprogress', points: 2, createdAt: at('2026-07-29T12:00:00Z') }),
        task({ _id: '6f0000000000000000000f25', sprintId: IDS.PRIVATE_SPRINT, statusType: 'close', points: 5, completion: human(IDS.OTHER), createdAt: at('2026-08-12T12:00:00Z'), updatedAt: at('2026-08-24T12:00:00Z') }),
        task({ _id: '6f0000000000000000000f26', sprintId: IDS.ACTIVE_SPRINT, statusType: 'onhold', points: 3, createdAt: at('2026-08-05T12:00:00Z') }),
        task({ _id: '6f0000000000000000000f27', sprintId: IDS.ACTIVE_SPRINT, statusType: 'open', points: 1, createdAt: at('2026-08-20T12:00:00Z') }),
        task({ _id: '6f0000000000000000000f28', sprintId: IDS.SPIKE, statusType: 'close', points: 1, createdAt: at('2026-08-02T12:00:00Z'), updatedAt: at('2026-08-14T12:00:00Z') }),
    ];
    tasks.forEach((t) => db.seed(SCHEMA_TYPE.TASKS, t));
    db.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: '6f0000000000000000000f21', createdAt: at('2026-07-22T12:00:00Z') });
    db.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: '6f0000000000000000000f23', createdAt: at('2026-08-06T12:00:00Z') });
    db.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: '6f0000000000000000000f25', createdAt: at('2026-08-21T12:00:00Z') });
};

/* The calls whose beta output the fixture holds. Local-time bounds, so the chart's
 * local days are the same calendar days wherever the test runs. */
const CASES = Object.freeze({
    velocity: [
        { name: 'owner, limit 50', uid: IDS.OWNER, query: { projectId: IDS.PROJECT, limit: 50 } },
        { name: 'owner, default limit', uid: IDS.OWNER, query: { projectId: IDS.PROJECT } },
        { name: 'member, limit 50', uid: IDS.MEMBER, query: { projectId: IDS.PROJECT, limit: 50 } },
        { name: 'other, limit 2', uid: IDS.OTHER, query: { projectId: IDS.PROJECT, limit: 2 } },
        { name: 'empty project', uid: IDS.OWNER, query: { projectId: IDS.EMPTY_PROJECT } },
    ],
    flow: [
        { name: 'owner, August', uid: IDS.OWNER, query: { projectId: IDS.PROJECT, from: '2026-08-01T00:00:00', to: '2026-08-31T00:00:00' } },
        { name: 'member, August', uid: IDS.MEMBER, query: { projectId: IDS.PROJECT, from: '2026-08-01T00:00:00', to: '2026-08-31T00:00:00' } },
        { name: 'owner, 153 days clamped', uid: IDS.OWNER, query: { projectId: IDS.PROJECT, from: '2026-04-01T00:00:00', to: '2026-08-31T00:00:00' } },
        { name: 'empty project', uid: IDS.OWNER, query: { projectId: IDS.EMPTY_PROJECT, from: '2026-08-01T00:00:00', to: '2026-08-31T00:00:00' } },
    ],
});

module.exports = { IDS, MEMBER_ROLE, CASES, seedAgileReports };
