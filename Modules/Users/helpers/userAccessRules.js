const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const MEMBER_FIELDS = [
    '_id', 'Employee_Email', 'Employee_FName', 'Employee_LName', 'Employee_Name',
    'Employee_profileImage', 'Employee_profileImageURL', 'Time_Format', 'Time_Zone',
    'isActive', 'isOnline', 'lastActive', 'AssignCompany', 'languageCode', 'workingHours',
    'presence', 'isVesionUpdate', 'createdAt', 'updatedAt',
];
const SELF_FIELDS = [
    ...MEMBER_FIELDS,
    'isEmailVerified', 'isProductOwner', 'tour', 'lastSelectedCompany', 'customerId', 'customerIds',
    'homeChecklist', 'localePreferences', 'agentAccount', 'demo',
];
// What a pre-authentication answer may carry: the sign-in, OAuth and sign-up screens read
// these, and the caller is only as trusted as the password or invite they arrived with, so
// the billing and ownership fields of the self view stay out of it.
const AUTH_FIELDS = [
    '_id', 'Employee_Email', 'Employee_FName', 'Employee_LName', 'Employee_Name',
    'Employee_profileImage', 'Employee_profileImageURL', 'Time_Format', 'Time_Zone',
    'isActive', 'isEmailVerified', 'AssignCompany', 'languageCode', 'createdAt', 'updatedAt',
];
const SELF_WRITABLE = [
    'isOnline', 'lastActive', 'lastSelectedCompany', 'tour', 'homeChecklist', 'presence', 'languageCode',
    'localePreferences', 'updatedAt', 'Employee_FName', 'Employee_LName', 'Employee_Name',
    'Employee_profileImage', 'Employee_profileImageURL', 'Time_Format', 'Time_Zone', 'workingHours',
];
const FILTER_FIELDS = ['_id', 'isActive', 'AssignCompany', 'Employee_Email', 'Employee_Name', 'Employee_FName', 'Employee_LName', 'isOnline'];
const FILTER_OPERATORS = ['$in', '$nin', '$eq', '$ne', '$exists'];
const LOGICAL_OPERATORS = ['$and', '$or', '$nor'];

const isObjectId = (value) => OBJECT_ID_PATTERN.test(String(value || ''));
const plain = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : doc);

const pick = (doc, fields) => {
    const source = plain(doc) || {};
    return fields.reduce((out, field) => {
        if (source[field] !== undefined) out[field] = source[field];
        return out;
    }, {});
};

const toSelfView = (doc) => pick(doc, SELF_FIELDS);

const toAuthView = (doc) => (doc ? pick(doc, AUTH_FIELDS) : null);

const toMemberView = (doc, sharedCompanyIds) => {
    const view = pick(doc, MEMBER_FIELDS);
    const shared = (sharedCompanyIds || []).map(String);
    view.AssignCompany = (view.AssignCompany || []).map(String).filter((id) => shared.includes(id));
    return view;
};

const sharedCompanies = (a, b) => {
    const left = ((a && a.AssignCompany) || []).map(String);
    return ((b && b.AssignCompany) || []).map(String).filter((id) => left.includes(id));
};

const isScalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

const cleanCondition = (condition) => {
    if (isScalar(condition)) return true;
    if (Array.isArray(condition)) return condition.every(isScalar);
    if (typeof condition !== 'object') return false;
    return Object.entries(condition).every(([op, arg]) => {
        if (!FILTER_OPERATORS.includes(op)) return false;
        if (op === '$in' || op === '$nin') return Array.isArray(arg) && arg.every(isScalar);
        return isScalar(arg);
    });
};

// The client used to send a raw $match. Only simple equality/membership filters on
// non-secret fields survive, so a caller cannot probe reset tokens with $regex or run $expr.
const sanitizeUserQuery = (query) => {
    if (query === undefined || query === null) return { ok: true, query: {} };
    if (typeof query !== 'object' || Array.isArray(query)) return { ok: false, error: 'query must be an object.' };
    for (const [key, value] of Object.entries(query)) {
        if (LOGICAL_OPERATORS.includes(key)) {
            if (!Array.isArray(value) || !value.every((part) => sanitizeUserQuery(part).ok)) {
                return { ok: false, error: `${key} must be a list of simple filters.` };
            }
            continue;
        }
        if (!FILTER_FIELDS.includes(key)) return { ok: false, error: `Filtering on ${key} is not allowed.` };
        if (!cleanCondition(value)) return { ok: false, error: `The filter on ${key} is not allowed.` };
    }
    return { ok: true, query };
};

const scopeQueryToCompany = (query, companyId) => ({ $and: [query || {}, { AssignCompany: String(companyId) }] });

const writableKey = (key) => {
    if (typeof key !== 'string' || key.includes('$')) return false;
    return SELF_WRITABLE.includes(key.split('.')[0]);
};

const sanitizeSelfUpdate = (updateObject) => {
    if (!updateObject || typeof updateObject !== 'object' || Array.isArray(updateObject)) {
        return { ok: false, error: 'updateObject must be an object.' };
    }
    const keys = Object.keys(updateObject);
    if (!keys.length) return { ok: false, error: 'updateObject is empty.' };
    const operatorKeys = keys.filter((key) => key.startsWith('$'));
    let fields;
    if (!operatorKeys.length) {
        fields = updateObject;
    } else if (keys.length === 1 && keys[0] === '$set' && updateObject.$set && typeof updateObject.$set === 'object' && !Array.isArray(updateObject.$set)) {
        fields = updateObject.$set;
    } else {
        return { ok: false, error: 'Only $set is allowed when updating your own profile.' };
    }
    const refused = Object.keys(fields).filter((key) => !writableKey(key));
    if (refused.length) return { ok: false, error: `These fields cannot be changed here: ${refused.join(', ')}.` };
    if (!Object.keys(fields).length) return { ok: false, error: 'updateObject is empty.' };
    return { ok: true, update: { $set: fields } };
};

// The one cross-user write the app makes: an owner or admin removing a member from their company.
const companyRemovalOf = (updateObject) => {
    if (!updateObject || typeof updateObject !== 'object') return null;
    const keys = Object.keys(updateObject);
    if (keys.length !== 1 || keys[0] !== '$pull') return null;
    const pull = updateObject.$pull;
    if (!pull || typeof pull !== 'object' || Object.keys(pull).length !== 1) return null;
    const companyId = pull.AssignCompany;
    return typeof companyId === 'string' && isObjectId(companyId) ? companyId : null;
};

const sanitizeUpdateOptions = (options) => (options && options.returnDocument === 'after' ? { returnDocument: 'after' } : undefined);

const PROFILE_IMAGE_FIELDS = ['Employee_profileImage', 'Employee_profileImageURL'];

/* A user may point their profile at an image they uploaded — the storage guards only let
 * them write a name starting with their own id — or leave the one their record already
 * holds, which is how an image uploaded before that rule keeps working. Any other name
 * would be someone else's image. */
const unownedProfileImages = (fields, currentUser, mayWrite) => {
    const held = PROFILE_IMAGE_FIELDS.map((field) => String((currentUser && currentUser[field]) || '')).filter(Boolean);
    return PROFILE_IMAGE_FIELDS
        .filter((field) => fields[field] !== undefined)
        .map((field) => String(fields[field] || ''))
        .filter((value) => value !== '' && !held.includes(value) && !mayWrite(value));
};

const hasProfileImage = (fields) => PROFILE_IMAGE_FIELDS.some((field) => fields[field] !== undefined);

module.exports = {
    MEMBER_FIELDS,
    SELF_FIELDS,
    AUTH_FIELDS,
    SELF_WRITABLE,
    isObjectId,
    toSelfView,
    toAuthView,
    toMemberView,
    sharedCompanies,
    sanitizeUserQuery,
    scopeQueryToCompany,
    sanitizeSelfUpdate,
    companyRemovalOf,
    sanitizeUpdateOptions,
    unownedProfileImages,
    hasProfileImage,
};
