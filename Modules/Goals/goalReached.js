const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { Notification_key: { GOAL_TARGET_REACHED, GOAL_REACHED }, GOAL_NOTICE_SECTION } = require('../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { textHtml } = require('../Template/emailText');
const access = require('./helpers/goalAccess');
const { TASKS } = require('./helpers/goalRules');

const CHANGE_TYPE = 'goal_reached';
const TELL_AGAIN_AFTER_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 200;

const clip = (value) => String(value || '').slice(0, NAME_MAX);
const isReached = (goal) => Boolean(goal) && (goal.targets || []).length > 0 && (goal.progressPct || 0) >= 100;

/* What a write is about to cross. A target tells when it arrives, and again only a day after it last told; the
 * goal the same. The marks ride on the write itself, which lands on one revision, so two writers cannot both tell. */
const stamped = (was, set, now = new Date()) => {
    if (!Array.isArray(set.targets)) return { set, due: [] };
    const before = new Map(((was && was.targets) || []).map((target) => [String(target.id), target]));
    const mayTell = (toldAt) => !toldAt || now.getTime() - new Date(toldAt).getTime() >= TELL_AGAIN_AFTER_MS;
    const due = [];
    const targets = set.targets.map((target) => {
        const old = before.get(String(target.id));
        if (!target.reachedAt || (old && old.reachedAt) || !mayTell(target.notifiedAt)) return target;
        due.push({ targetId: String(target.id), targetName: target.name, byCount: target.kind === TASKS });
        return { ...target, notifiedAt: now };
    });
    const next = { ...set, targets };
    const arrived = isReached(next) && !isReached(was);
    const tellGoal = arrived && mayTell(was && was.notifiedAt);
    if (tellGoal) due.push({});
    return {
        set: { ...next, reachedAt: isReached(next) ? ((!arrived && was.reachedAt) || now) : null, ...(tellGoal ? { notifiedAt: now } : {}) },
        due,
    };
};

/* The owner and the people the goal is shared with by name, and of those only who holds a seat and can still read it. */
const readersOf = async (companyId, goal) => {
    const named = [...new Set([goal.ownerUserId, ...(goal.sharedWith || [])].filter(Boolean).map(String))];
    const seats = (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: { $in: named }, ...ACTIVE_SEAT }, { userId: 1, roleType: 1 }],
    }, 'find')) || [];
    const roles = new Map(seats.map((seat) => [String(seat.userId), seat.roleType]));
    return named.filter((uid) => roles.has(uid) && access.canSee(goal, { uid, isGuest: roles.get(uid) === ROLE_GUEST }));
};

/* A notice names the goal and the target, and nothing a target is counted from. The pipeline leaves the sender out
 * of the recipients and looks it up by object id: a person who set the value is the sender, and a count is sent
 * in the goal's own name, so everyone hears of it. */
const noticeOf = (companyId, goal, item, actorId, readers) => {
    const goalName = clip(goal.name);
    const targetName = clip(item.targetName);
    const byCount = item.targetId ? item.byCount : !actorId;
    return {
        key: item.targetId ? GOAL_TARGET_REACHED : GOAL_REACHED,
        type: GOAL_NOTICE_SECTION.key,
        message: textHtml(item.targetId ? `The target "${targetName}" of the goal "${goalName}" is reached.` : `The goal "${goalName}" is reached.`),
        companyId: String(companyId),
        userId: byCount ? String(goal._id) : String(actorId),
        assigneeUsers: readers,
        notSeen: readers,
        directUsers: readers,
        isSelected: false,
        changeType: CHANGE_TYPE,
        changeData: { goalId: String(goal._id), goalName, ...(item.targetId ? { targetId: item.targetId, targetName } : {}), byCount },
    };
};

/* Never fails the write that crossed: what could not be told is logged. */
const tell = async (companyId, goal, due, actorId = '') => {
    if (!due.length) return [];
    try {
        const readers = await readersOf(companyId, goal);
        if (!readers.length) return [];
        // Required here: the pipeline pulls in storage and the user controllers, which must not load just because goals did.
        const { ensureGoalNoticeSection } = require('../notification/goalNotices');
        const notices = require('../notification/prepare-notification-data/controllerV2');
        await ensureGoalNoticeSection(companyId, readers);
        for (const item of due) await notices.handleSingleNotification(noticeOf(companyId, goal, item, actorId, readers));
        return readers;
    } catch (error) {
        logger.error(`goals: a reached notice for goal ${goal._id} was not sent: ${error.message || error}`);
        return [];
    }
};

module.exports = { CHANGE_TYPE, TELL_AGAIN_AFTER_MS, stamped, readersOf, tell };
