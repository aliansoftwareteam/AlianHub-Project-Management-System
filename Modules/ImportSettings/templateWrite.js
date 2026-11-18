const mongoose = require('mongoose');
const { schema } = require('../../utils/mongo-handler/schema');
const { isPlainObject, isObjectIdText } = require('../Company/helpers/callerQueryRules');
const { TEAM_PREFIX, namedIds, nonMembersOf, foreignTeamsOf } = require('../../Config/companyMembers');

const MAX_TEMPLATES = 100;
const NAME_MAX = 250;
const MAX_DEPTH = 20;
const PEOPLE = ['AssigneeUserId', 'LeadUserId'];
const SET_BY_SERVER = ['CompanyId'];

const FIELDS = Object.entries(schema.companyProjectTemplate).filter(([name]) => !SET_BY_SERVER.includes(name));

const FITS = new Map([
    [String, (value) => typeof value === 'string'],
    [Number, Number.isFinite],
    [Array, Array.isArray],
    [Map, isPlainObject],
]);

/* A template's values are stored as they are sent, so none of them carries an operator, at any depth. */
const holdsOperator = (value, depth = 0) => {
    if (depth > MAX_DEPTH) return true;
    if (Array.isArray(value)) return value.some((item) => holdsOperator(item, depth + 1));
    if (value === null || typeof value !== 'object') return false;
    if (!isPlainObject(value)) return true;
    return Object.entries(value).some(([key, inner]) => key.startsWith('$') || holdsOperator(inner, depth + 1));
};

const fieldProblem = ([name, rule], template) => {
    const value = template[name];
    if (value === undefined || value === null) return rule.required ? `A template needs ${name}.` : '';
    const fits = FITS.get(rule.type);
    return (fits && !fits(value)) || holdsOperator(value) ? `${name} is not valid.` : '';
};

const oneTemplateProblem = (template) => {
    if (!isPlainObject(template)) return 'Each template is a set of template fields.';
    if (template._id !== undefined && !isObjectIdText(template._id)) return 'A template id is not valid.';
    const name = typeof template.TemplateName === 'string' ? template.TemplateName.trim() : '';
    if (!name) return 'A template needs TemplateName.';
    if (name.length > NAME_MAX) return `A template name can be at most ${NAME_MAX} characters.`;
    return FIELDS.map((field) => fieldProblem(field, template)).find(Boolean) || '';
};

/* Why a list of templates cannot be imported, or '' when each one is a template and nothing else. */
const templatesProblem = (templates) => {
    if (!Array.isArray(templates) || !templates.length) return 'template is required.';
    if (templates.length > MAX_TEMPLATES) return `One import takes at most ${MAX_TEMPLATES} templates.`;
    return templates.map(oneTemplateProblem).find(Boolean) || '';
};

const peopleOf = (template) => namedIds(PEOPLE.flatMap((field) => template[field] || []).filter((id) => typeof id === 'string'));

const knownFields = (template) => Object.fromEntries(FIELDS.map(([name]) => [name, template[name]]).filter(([, value]) => value !== undefined && value !== null));

/* The write for each template, built here from the fields a template has: the row an id names, or a new one.
 * People a template names are kept only while they hold a seat in this company, and teams while they are its teams. */
const templateWritesOf = async (companyId, templates) => {
    const named = namedIds(templates.flatMap(peopleOf));
    const isTeam = (id) => id.startsWith(TEAM_PREFIX);
    const outside = new Set([
        ...await nonMembersOf(companyId, named.filter((id) => !isTeam(id))),
        ...await foreignTeamsOf(companyId, named.filter(isTeam)),
    ]);
    const here = (ids) => namedIds(ids.filter((id) => typeof id === 'string')).filter((id) => !outside.has(id));
    return templates.map((template) => {
        const doc = { ...knownFields(template), TemplateName: template.TemplateName.trim(), CompanyId: String(companyId) };
        PEOPLE.forEach((field) => { doc[field] = here(doc[field] || []); });
        return template._id === undefined
            ? { method: 'save', data: doc }
            : { method: 'findOneAndUpdate', data: [{ _id: new mongoose.Types.ObjectId(template._id) }, { $set: doc }, { upsert: true, returnDocument: 'after' }] };
    });
};

module.exports = { MAX_TEMPLATES, templatesProblem, templateWritesOf };
