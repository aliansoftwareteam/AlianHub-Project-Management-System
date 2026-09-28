const { evaluatePermission, isWritable } = require('../../Config/permissionGuard');
const { nonMembersOf, NOT_A_MEMBER } = require('../../Config/companyMembers');
const logger = require('../../Config/loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NEW_TEAM_FIELDS = ['name', 'value', 'teamColor', 'assigneeUsersArray', 'createdAt'];
const SET_FIELDS = ['name', 'value', 'teamColor', 'updatedAt'];
const COLOR_FIELDS = ['bgColor', 'color'];
const MEMBER_OPERATORS = ['$addToSet', '$pull'];

class TeamWriteError extends Error {
    constructor(message) {
        super(message);
        this.statusCode = 400;
    }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const onlyFields = (object, allowed) => Object.keys(object).every((key) => allowed.includes(key));

const checkColor = (color) => {
    const keys = isPlainObject(color) ? Object.keys(color) : [];
    const valid = keys.length > 0 && onlyFields(color, COLOR_FIELDS) && keys.every((key) => typeof color[key] === 'string');
    if (!valid) throw new TeamWriteError('A team colour takes only a bgColor and a color.');
    return Object.fromEntries(keys.map((key) => [key, color[key]]));
};

const checkNames = ({ name, value }) => {
    if (!isText(name) || !isText(value)) throw new TeamWriteError('A team needs a name.');
};

const checkMembers = async (companyId, ids) => {
    if ((await nonMembersOf(companyId, ids)).length) throw new TeamWriteError(NOT_A_MEMBER);
};

const newTeamFrom = async (companyId, body) => {
    if (!isPlainObject(body) || !onlyFields(body, NEW_TEAM_FIELDS)) throw new TeamWriteError('A team takes only a name, value, colour and members.');
    checkNames(body);
    const members = body.assigneeUsersArray === undefined ? [] : body.assigneeUsersArray;
    if (!Array.isArray(members) || !members.every((id) => typeof id === 'string')) throw new TeamWriteError('Team members must be a list of user ids.');
    await checkMembers(companyId, members);
    return { name: body.name, value: body.value, teamColor: checkColor(body.teamColor), assigneeUsersArray: [...new Set(members)] };
};

const setFrom = (updateObject) => {
    if (!onlyFields(updateObject, SET_FIELDS)) throw new TeamWriteError('Only the name, value and colour of a team can be set.');
    const set = {};
    if ('name' in updateObject || 'value' in updateObject) {
        checkNames(updateObject);
        Object.assign(set, { name: updateObject.name, value: updateObject.value });
    }
    if ('teamColor' in updateObject) set.teamColor = checkColor(updateObject.teamColor);
    if (!Object.keys(set).length) throw new TeamWriteError('Nothing to update.');
    return { $set: set };
};

const teamUpdateFrom = async (companyId, { key, updateObject }) => {
    if (!isPlainObject(updateObject)) throw new TeamWriteError('Nothing to update.');
    if (key === '$set') return setFrom(updateObject);
    if (!MEMBER_OPERATORS.includes(key)) throw new TeamWriteError('Unsupported team update.');
    const member = updateObject.assigneeUsersArray;
    if (!onlyFields(updateObject, ['assigneeUsersArray']) || !OBJECT_ID.test(String(typeof member === 'string' ? member : ''))) {
        throw new TeamWriteError('Add or remove one member at a time.');
    }
    if (key === '$addToSet') await checkMembers(companyId, [member]);
    return { [key]: { assigneeUsersArray: member } };
};

const teamIdFrom = (id) => {
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw new TeamWriteError('A valid team id is required.');
    return id;
};

/* A hard gate on the settings key the Teams screen checks, whatever the enforcement mode: team membership grants project access. */
const managesTeams = (permission) => async (req, res, next) => {
    const refuse = (statusText) => res.status(403).json({ status: false, statusText, message: statusText, permission });
    try {
        const allowed = isWritable(await evaluatePermission(req.headers['companyid'], req.uid, permission, { strict: true }));
        return allowed ? next() : refuse('You do not have permission to manage teams.');
    } catch (error) {
        logger.error(`managesTeams (${permission}): ${error.message || error}`);
        return refuse('Permission check failed.');
    }
};

module.exports = { managesTeams, newTeamFrom, teamUpdateFrom, teamIdFrom, TeamWriteError };
