const { getRoleType, evaluatePermission, isPrivileged, ROLE_GUEST } = require('../../../Config/permissionGuard');
const { SEAT_ACTIVE } = require('../../../Config/seatStatus');

const MEMBER_LIST_PERMISSION = 'settings.settings_member_list';

const ROW_FIELDS = ['_id', 'companyId', 'status', 'isDelete'];
const SEAT_FIELDS = ['roleType', 'designation'];
const COLLEAGUE_FIELDS = ['userEmail', 'managerId'];
const SEAT_STATE_FIELDS = ['sendInvitationTime', 'isTrackerUser', 'isRestrict', 'workloadCapacity', 'createdAt', 'updatedAt'];
const MANAGED_FIELDS = [
    ...SEAT_FIELDS, ...COLLEAGUE_FIELDS, ...SEAT_STATE_FIELDS,
    'scimExternalId', 'scimGivenName', 'scimFamilyName', 'scimDeactivatedSeatAt', 'legacyId', 'demo',
];
const OWN_FIELDS = [
    ...COLLEAGUE_FIELDS, ...SEAT_STATE_FIELDS,
    'dashboardLocked', 'aiRequestedCount', 'ProjectRequiredComponent', 'embedViews',
];
const COUNT_FIELDS = ['roleType', 'designation', 'status', 'isDelete'];
const IN_USE_FIELDS = ['roleType', 'designation'];

const plain = (row) => JSON.parse(JSON.stringify(row));
const isScalar = (value) => ['string', 'number', 'boolean'].includes(typeof value);

/* Who is reading: an owner or admin may invite, a role holding the member list manages seats,
 * a guest is outside the company, and a caller with no live seat reads as a guest. */
const viewerOf = async (companyId, uid) => {
    const roleType = await getRoleType(companyId, uid);
    const invites = isPrivileged(roleType);
    const manages = invites || (roleType !== null && await evaluatePermission(companyId, uid, MEMBER_LIST_PERMISSION) === true);
    return { uid: String(uid || ''), manages, invites, outside: roleType === null || roleType === ROLE_GUEST };
};

const COLLEAGUE = Object.freeze({ uid: '', manages: false, invites: false, outside: false });

/* An invitation row carries the invitee's account id when the address is already registered
 * somewhere. Until the seat is accepted that id is not the company's to see. */
const fieldsFor = (viewer, row) => {
    const accepted = Number(row.status) === SEAT_ACTIVE;
    const fields = [...ROW_FIELDS];
    if (accepted) fields.push('userId', ...SEAT_FIELDS);
    if (viewer.manages) fields.push(...MANAGED_FIELDS);
    else if (accepted && row.isDelete !== true && !viewer.outside) fields.push(...COLLEAGUE_FIELDS);
    if (accepted && viewer.uid && String(row.userId || '') === viewer.uid) fields.push(...OWN_FIELDS);
    if (viewer.invites && !accepted) fields.push('linkId');
    return fields;
};

const pick = (source, fields) => fields.reduce((view, field) => {
    if (source[field] !== undefined) view[field] = source[field];
    return view;
}, {});

const memberRowFor = (viewer) => (row) => {
    if (!row || typeof row !== 'object') return row;
    const source = plain(row);
    return pick(source, fieldsFor(viewer, source));
};

const colleagueFieldsOf = (changes) => pick(changes || {}, [...ROW_FIELDS, ...SEAT_FIELDS, ...COLLEAGUE_FIELDS]);

const countFilterOf = (query) => {
    if (query === undefined || query === null) return {};
    if (typeof query !== 'object' || Array.isArray(query)) return null;
    const usable = Object.entries(query).every(([field, value]) => COUNT_FIELDS.includes(field) && isScalar(value));
    return usable ? query : null;
};

const inUseFilterOf = (key, value) => {
    const wanted = Number(value);
    return IN_USE_FIELDS.includes(key) && String(value).trim() !== '' && Number.isInteger(wanted) ? { [key]: wanted } : null;
};

module.exports = { COLLEAGUE, viewerOf, memberRowFor, colleagueFieldsOf, countFilterOf, inUseFilterOf };
