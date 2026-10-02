const rules = require('../Agents/automationRequests');
const { GRANT } = require('./manageFlag');
const { loadProject } = require('./dataTools');

// Automations for one project. A rule runs later with nobody watching, so a call never makes one: it is filed for
// an owner or an admin to approve in AlianHub (its action is proposeOnly, Agents/registry/automation.js), and what
// is approved is saved by the Automations page's own route as that person (Modules/Agents/automationRequests.js).

const REASON_MAX = 500;
const str = (v, max = REASON_MAX) => String(v === undefined || v === null ? '' : v).slice(0, max);
const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const KEY = Object.freeze({ type: 'string', minLength: 1, maxLength: rules.KEY_MAX });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

const CONDITION = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
        field: { ...KEY, description: 'A condition field of automation.catalogue' },
        op: { ...KEY, description: 'One of that field\'s operators' },
        value: { description: 'What to compare with: a status, a person or a task type by its name, a list for an operator that takes one, nothing for one that takes none' },
    },
    required: ['field', 'op'],
});

const STEP = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
        action: { ...KEY, description: `One of ${rules.MAY_PROPOSE.join(', ')}` },
        config: { type: 'object', description: 'That step\'s settings, as automation.catalogue lists them' },
    },
    required: ['action'],
});

/* Refused here, before anything is read for the answer: a person who may not manage rules, then a draft that
 * names what the project does not have. A project the caller cannot open is left to the target check. */
const vetted = async (ctx, args, vis) => {
    const project = await loadProject(ctx, vis, args.projectId);
    if (!project) return { args };
    if (!(await rules.mayManage(ctx.companyId, ctx.userId))) {
        throw await require('../Agents/actions').refusal(ctx.companyId, ctx.actor, { action: rules.ACTION, params: { projectId: str(args.projectId, 40) }, reason: rules.REFUSED.filer, ip: ctx.ip, taint: ctx.taint });
    }
    const problem = await rules.proposalProblem({ companyId: ctx.companyId, uid: ctx.userId, draft: rules.draftOf(args) });
    return problem ? { answer: { ok: false, error: problem } } : { args };
};

/* What a rule is made of, for this tool and for a rule inside a plan (./setupTools.js). */
const DRAFT = Object.freeze({
    trigger: { ...KEY, description: 'A trigger key of automation.catalogue' },
    conditions: { type: 'array', maxItems: rules.CONDITIONS_MAX, items: CONDITION },
    actions: { type: 'array', minItems: 1, maxItems: rules.STEPS_MAX, items: STEP },
});

const TOOLS = [
    {
        name: 'automation.catalogue',
        action: 'automation.catalogue',
        visibility: 'none',
        visibilityReason: 'Lists the kinds of trigger, condition and step a rule is made of; it reads nothing from any workspace.',
        strict: true,
        readParams: () => ({}),
        description: 'What an automation can be made of: the triggers a rule can start from, the fields a condition can test with their operators, and the steps a rule can take with their settings. Read it before automation.create and copy its keys exactly.',
        input: input({}, []),
        run: async () => rules.catalogueForAgents(),
    },
    {
        name: 'automation.create',
        action: rules.ACTION,
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: (args) => ({ projectId: str(args.projectId, 40) }),
        description: 'Propose one automation for one project: a trigger, optional conditions (all must hold) and the steps to take, in the terms of automation.catalogue. '
            + 'Write a status, a person or a task type by its name. Nothing is made by the call: it answers that the rule is waiting, and an owner or an admin approves it in AlianHub, '
            + 'where they see the rule in a sentence, each step, and how many recent tasks it matches. The rule is saved in their name, switched off unless enabled is true, and they can undo it. '
            + 'Only owners and admins can have a rule proposed for them. If a part of what the person asked for cannot be written in the catalogue\'s terms, tell them which part; if the trigger cannot, do not call this.',
        input: input({
            projectId: ID,
            ...DRAFT,
            enabled: { type: 'boolean', description: 'true to switch the rule on as soon as it is approved; left out, it is saved switched off' },
            reason: { type: 'string', maxLength: REASON_MAX, description: 'Why, in a line; it is kept in the audit log' },
        }, ['projectId', 'trigger', 'actions']),
        check: (args) => rules.draftProblem(args),
        prepare: vetted,
        params: (args) => rules.draftOf(args),
    },
];

const READ_SCOPES = Object.freeze({ 'automation.catalogue': 'projects:read' });

module.exports = { TOOLS, READ_SCOPES, DRAFT };
