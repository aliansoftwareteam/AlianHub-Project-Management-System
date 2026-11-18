const roleHandoff = require('./stepTypes/roleHandoff');
const approval = require('./stepTypes/approval');

// The ready-made team workflows of task 048 (Tasks/active/048-team-agent-packs/resources/team-workflows.md), as
// definitions a person installs. Each is saved disabled like any other definition, so nothing starts until a person
// enables it and starts a run on a task. A task sits in one role's queue at a time, so a chain the design runs in
// parallel is a line here. Only roles that exist under Modules/Agents/roles are named.

const hand = (id, role, after) => ({ id, type: roleHandoff.TYPE, dependsOn: after ? [after] : [], config: { role } });
const gate = (id, title, ownerRole, prompt, after) => ({ id, type: approval.TYPE, dependsOn: [after], config: { title, ownerRole, prompt, onReject: 'skip' } });

const chain = (...steps) => steps.map((step, i) => (i === 0 || step.dependsOn.length ? step : { ...step, dependsOn: [steps[i - 1].id] }));

const TEMPLATES = Object.freeze([
    {
        key: 'marketing-campaign-launch',
        name: 'Marketing: campaign launch',
        description: 'The campaign is planned, approved, written, checked against the brand, approved again and turned into a post set, then reported on.',
        steps: chain(
            hand('sPlan', 'agency/campaign-manager'),
            gate('sPlanOk', 'Approve the campaign plan', 'marketing lead', 'Read the plan and approve it, or send it back with a comment.', 'sPlan'),
            hand('sWrite', 'agency/content-writer'),
            hand('sSeo', 'agency/seo-specialist'),
            hand('sBrand', 'agency/agency-brand-guardian'),
            gate('sPiecesOk', 'Approve the pieces', 'marketing lead', 'The pieces are written and checked. Approve them for launch, or send them back.', 'sBrand'),
            hand('sSocial', 'agency/social-media-manager'),
            hand('sReport', 'agency/marketing-analyst'),
        ),
    },
    {
        key: 'design-request-to-handoff',
        name: 'Design: from request to handoff',
        description: 'A request becomes a design brief the requester approves, then flows and specs checked against the brand, approved by the design lead.',
        steps: chain(
            hand('sBrief', 'it-company/design-lead'),
            gate('sBriefOk', 'Approve the design brief', 'requester', 'Read the brief and approve it, or send it back with a comment.', 'sBrief'),
            hand('sSpec', 'it-company/ui-ux-designer'),
            hand('sBrand', 'it-company/brand-guardian'),
            gate('sDesignOk', 'Approve the design', 'design lead', 'The flows, states and specs are ready. Approve them for handoff, or send them back.', 'sBrand'),
        ),
    },
    {
        key: 'engineering-design-to-release',
        name: 'Engineering: feature from design to release',
        description: 'The work is planned and approved, tests are written, the build is reviewed and checked against the design, and the release is approved and noted.',
        steps: chain(
            hand('sPlan', 'it-company/tech-lead'),
            gate('sPlanOk', 'Approve the plan', 'engineering lead', 'Read the sprint plan and approve it, or send it back with a comment.', 'sPlan'),
            hand('sTests', 'it-company/qa-engineer'),
            hand('sReview', 'it-company/code-reviewer'),
            hand('sDesignQa', 'it-company/design-qa-reviewer'),
            gate('sReleaseOk', 'Approve the release', 'engineering lead', 'The build is reviewed and checked against the design. Approve the release, or send it back.', 'sDesignQa'),
            hand('sNotes', 'it-company/release-manager'),
        ),
    },
    {
        key: 'support-customer-bug',
        name: 'Support to Engineering: a customer bug',
        description: 'A request is triaged, the bug is filed and placed in a sprint, the fix is noted in a release, and a person sends the reply.',
        steps: chain(
            hand('sTriage', 'it-company/support-agent'),
            hand('sFile', 'it-company/bug-triager'),
            hand('sPlace', 'it-company/tech-lead'),
            hand('sRelease', 'it-company/release-manager'),
            hand('sReply', 'it-company/support-lead'),
            gate('sSend', 'Send the reply', 'support lead', 'The reply is drafted. Send it yourself, then approve; agents never send messages outside AlianHub.', 'sReply'),
        ),
    },
    {
        key: 'sales-new-customer-onboarding',
        name: 'Sales: new customer onboarding',
        description: 'A lead that became a customer gets an account plan; the account owner approves, and support is told what was promised.',
        steps: chain(
            hand('sLead', 'it-company/sales-development-rep'),
            hand('sAccount', 'it-company/account-manager'),
            gate('sPlanOk', 'Approve the account plan', 'account owner', 'Read the account plan and approve it, or send it back with a comment.', 'sAccount'),
            hand('sSupport', 'it-company/support-lead'),
        ),
    },
    {
        key: 'manufacturing-order-to-dispatch',
        name: 'Manufacturing: order to dispatch',
        description: 'An order is recorded and confirmed, scheduled, bought for, made, inspected, dispatched and tracked; a person sends the customer note.',
        steps: chain(
            hand('sIntake', 'manufacturing/order-intake'),
            gate('sConfirm', 'Confirm the order', 'sales', 'Read the order and what is unclear, then confirm it or send it back.', 'sIntake'),
            hand('sPlan', 'manufacturing/production-planner'),
            hand('sWatch', 'manufacturing/schedule-change-watch'),
            hand('sBuy', 'manufacturing/purchase-request-preparer'),
            gate('sBuyerOk', 'Approve the purchase request', 'buyer', 'Read the purchase request and approve it, or send it back.', 'sBuy'),
            hand('sChase', 'manufacturing/supplier-follow-up'),
            hand('sHandover', 'manufacturing/shift-handover-writer'),
            hand('sDowntime', 'manufacturing/downtime-logger'),
            hand('sInspect', 'manufacturing/inspection-checklist'),
            hand('sDispatch', 'manufacturing/dispatch-checklist'),
            hand('sDeliver', 'manufacturing/delivery-tracker'),
            hand('sNote', 'manufacturing/customer-update-writer'),
            gate('sSend', 'Send the customer note', 'sales', 'The note is drafted. Send it yourself, then approve; agents never send messages outside AlianHub.', 'sNote'),
        ),
    },
    {
        key: 'manufacturing-quality-problem',
        name: 'Manufacturing: a quality problem',
        description: 'A failure is recorded; the quality lead decides; the corrective action runs and the instruction and any design change are updated and approved.',
        steps: chain(
            hand('sFind', 'manufacturing/inspection-checklist'),
            hand('sRecord', 'manufacturing/non-conformance-recorder'),
            gate('sDecide', 'Decide: rework, scrap or accept', 'quality lead', 'Read the record and decide what happens to the batch.', 'sRecord'),
            hand('sAction', 'manufacturing/corrective-action-tracker'),
            hand('sInstruction', 'manufacturing/work-instruction-keeper'),
            hand('sChange', 'manufacturing/change-request-writer'),
            gate('sEngineering', 'Approve the change', 'engineering', 'Read the change request and approve it, or send it back.', 'sChange'),
        ),
    },
    {
        key: 'manufacturing-breakdown',
        name: 'Manufacturing: a breakdown',
        description: 'A stop is recorded, the repair is placed, the parts are checked and bought, the orders are moved and their owners told.',
        steps: chain(
            hand('sTriage', 'manufacturing/breakdown-triage'),
            hand('sRepair', 'manufacturing/maintenance-planner'),
            hand('sParts', 'manufacturing/spare-parts-watch'),
            hand('sBuy', 'manufacturing/purchase-request-preparer'),
            hand('sMove', 'manufacturing/production-planner'),
            hand('sTell', 'manufacturing/schedule-change-watch'),
        ),
    },
]);

const roleKeysOf = (template) => template.steps.filter((step) => step.type === roleHandoff.TYPE).map((step) => step.config.role);

const all = () => TEMPLATES;

const find = (key) => TEMPLATES.find((template) => template.key === String(key)) || null;

const copyOf = (template) => ({ name: template.name, description: template.description, steps: JSON.parse(JSON.stringify(template.steps)) });

module.exports = { all, find, roleKeysOf, copyOf };
