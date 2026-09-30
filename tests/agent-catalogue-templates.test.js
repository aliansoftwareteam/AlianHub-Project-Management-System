jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { CATALOGUE_TEMPLATES, DRAFT_MAX_AUTONOMY } = require('../frontend/src/views/Ai/agentTemplates');
const registry = require('../Modules/Agents/registry');
const codeSkills = require('../Modules/Agents/skills');
const builder = require('../Modules/Agents/builder');

// What each `blockedBy` waits for. Once every action is in the registry and every skill
// ships, the blocker is stale and the template has to be offered.
const BLOCKERS = Object.freeze({
    ai_fields: { actions: ['aifield.fill'], skills: ['fields.fill'] },
    pages: { actions: ['task.comment'], skills: ['wiki.upkeep'] },
    doc_drafting: { actions: ['page.draft'], skills: ['prd.draft'] },
});

const capabilityExists = ({ actions, skills }) => actions.every((key) => registry.knows(key)) && skills.every((key) => Boolean(codeSkills.getSkill(key)));
const bySlug = (slug) => CATALOGUE_TEMPLATES.find((tpl) => tpl.slug === slug);
const writesOf = (tpl) => tpl.actions.filter((key) => registry.get(key) && registry.get(key).write);

describe('the agent templates keep only promises the engine can keep', () => {
    it.each(CATALOGUE_TEMPLATES.map((tpl) => [tpl.slug, tpl]))('%s names only actions the registry knows', (slug, tpl) => {
        expect(tpl.actions.filter((key) => !registry.knows(key))).toEqual([]);
        expect(registry.allowedActionsToStore(tpl.actions)).toEqual([...tpl.actions]);
    });

    it.each(CATALOGUE_TEMPLATES.map((tpl) => [tpl.slug, tpl]))('%s names only skills that ship', (slug, tpl) => {
        expect(tpl.skills.filter((key) => !codeSkills.getSkill(key))).toEqual([]);
    });

    it('blocks a template only on something that is still missing', () => {
        const stale = CATALOGUE_TEMPLATES.filter((tpl) => tpl.blockedBy)
            .filter((tpl) => !BLOCKERS[tpl.blockedBy] || capabilityExists(BLOCKERS[tpl.blockedBy]))
            .map((tpl) => `${tpl.slug}: ${tpl.blockedBy}`);
        expect(stale).toEqual([]);
    });

    it('treats a blocker as stale once its actions and skills exist', () => {
        expect(capabilityExists({ actions: ['page.draft'], skills: ['prd.draft'] })).toBe(true);
        expect(capabilityExists({ actions: ['page.draft'], skills: ['no.such.skill'] })).toBe(false);
        expect(capabilityExists({ actions: ['no.such.action'], skills: [] })).toBe(false);
    });

    it.each(CATALOGUE_TEMPLATES.map((tpl) => [tpl.slug, tpl]))('%s grants every action its skills propose', (slug, tpl) => {
        const proposed = tpl.skills.flatMap((key) => codeSkills.getSkill(key).emits || []);
        expect(proposed.filter((key) => !tpl.actions.includes(key))).toEqual([]);
    });

    it('starts every template at or under the ceiling the builder holds a new agent to', () => {
        expect(DRAFT_MAX_AUTONOMY).toBe(builder.SAFEST_AUTONOMY);
        CATALOGUE_TEMPLATES.forEach((tpl) => expect(tpl.autonomy).toBeLessThanOrEqual(builder.SAFEST_AUTONOMY));
    });

    it.each(['field_filler', 'prd_writer', 'wiki_upkeep'])('%s can be picked, and a skill of its own proposes each write it grants', (slug) => {
        const tpl = bySlug(slug);
        expect(tpl.blockedBy).toBeNull();
        expect(tpl.skills.length).toBeGreaterThan(0);
        const proposed = new Set(tpl.skills.flatMap((key) => codeSkills.getSkill(key).emits || []));
        expect(writesOf(tpl).filter((key) => !proposed.has(key))).toEqual([]);
    });
});
