const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const { othersPersonalListIds } = require('../PersonalList/ownership');
const { conversationsOfOthers } = require('../Comments/helpers/conversationReaders');

// An agent record follows the work it is about. A personal list is its owner's alone and a direct
// message its participants', so a run or proposal there is read by them and by the person the agent
// worked for, whatever anyone else's role. A conversation with an agent is read by the person in it.
// A conversation kept in a project is its participants' in the same way.
// The rule is written twice, as a query clause and as a check on a record already read;
// tests/agent-records-private-work.test.js holds the two together.

const CHAT_KIND = 'chat';

const idsOf = async (companyId, type, filter) => ((await MongoDbCrudOpration(companyId, { type, data: [filter, { _id: 1 }] }, 'find')) || [])
    .map((row) => String(row._id));

const privateWorkOf = async (companyId, uid) => {
    const user = String(uid || '');
    const [personalLists, directSpaces, myChats] = await Promise.all([
        othersPersonalListIds(companyId, user),
        idsOf(companyId, SCHEMA_TYPE.MAIN_CHATS, { default: true }),
        idsOf(companyId, SCHEMA_TYPE.TASKS, { mainChat: true, AssigneeUserId: user }),
    ]);
    const othersChatsElsewhere = await idsOf(companyId, SCHEMA_TYPE.TASKS, { ...conversationsOfOthers(user), ProjectID: { $nin: idForms(directSpaces) } });
    const myRuns = personalLists.length
        ? await idsOf(companyId, SCHEMA_TYPE.AGENT_RUNS, { projectId: { $in: idForms(personalLists) }, startedBy: user })
        : [];
    return { uid: user, personalLists, directSpaces, myChats, othersChatsElsewhere, myRuns };
};

const nor = (clauses) => {
    const kept = clauses.filter(Boolean);
    return kept.length ? { $nor: kept } : {};
};

const inDirectMessageOfOthers = (scope) => scope.directSpaces.length
    && { projectId: { $in: idForms(scope.directSpaces) }, taskId: { $nin: idForms(scope.myChats) } };

const inConversationOfOthersElsewhere = (scope) => (scope.othersChatsElsewhere || []).length
    && { taskId: { $in: idForms(scope.othersChatsElsewhere) } };

const runClause = (scope) => nor([
    scope.personalLists.length && { projectId: { $in: idForms(scope.personalLists) }, startedBy: { $ne: scope.uid } },
    { kind: CHAT_KIND, startedBy: { $ne: scope.uid } },
    inDirectMessageOfOthers(scope),
    inConversationOfOthersElsewhere(scope),
]);

const proposalClause = (scope) => nor([
    scope.personalLists.length && { projectId: { $in: idForms(scope.personalLists) }, runId: { $nin: idForms(scope.myRuns) }, requestedBy: { $ne: scope.uid } },
    inDirectMessageOfOthers(scope),
    inConversationOfOthersElsewhere(scope),
]);

/* The comments of the same private work, for a read that reaches the comments collection itself. */
const commentClause = (scope) => nor([
    scope.personalLists.length && { projectId: { $in: idForms(scope.personalLists) } },
    inDirectMessageOfOthers(scope),
    inConversationOfOthersElsewhere(scope),
]);

const within = (ids, id) => ids.map(String).includes(String(id === undefined || id === null ? '' : id));

const readsConversation = (scope, record) => (!within(scope.directSpaces, record.projectId) || within(scope.myChats, record.taskId))
    && !within(scope.othersChatsElsewhere || [], record.taskId);

const readsRun = (scope, run) => (!within(scope.personalLists, run.projectId) || String(run.startedBy || '') === scope.uid)
    && (run.kind !== CHAT_KIND || String(run.startedBy || '') === scope.uid)
    && readsConversation(scope, run);

const readsProposal = (scope, proposal) => (!within(scope.personalLists, proposal.projectId)
        || within(scope.myRuns, proposal.runId) || String(proposal.requestedBy || '') === scope.uid)
    && readsConversation(scope, proposal);

module.exports = { privateWorkOf, runClause, proposalClause, commentClause, readsRun, readsProposal };
