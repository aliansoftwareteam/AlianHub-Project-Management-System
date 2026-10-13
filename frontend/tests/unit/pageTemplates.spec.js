import { describe, expect, it } from 'vitest';
import templates from '@/components/molecules/Pages/pageTemplates';

describe('the doc templates', () => {
    it('offer spec, retro, runbook, meeting and release in that order', () => {
        expect(templates.map((template) => template.key)).toEqual(['spec', 'retro', 'runbook', 'meeting', 'release']);
    });

    it('give every template a label and hint that go through translation', () => {
        templates.forEach((template) => {
            expect(template.label).toBe(`Docs.template_${template.key}`);
            expect(template.hint).toBe(`Docs.template_${template.key}_hint`);
            expect(template.icon).toBeTruthy();
        });
    });

    it('start every template with something to write on', () => {
        templates.forEach((template) => {
            expect(template.blocks.length).toBeGreaterThan(0);
        });
    });

    it('only use block kinds the editor knows', () => {
        const allowed = ['header', 'paragraph', 'list', 'checklist', 'callout'];
        templates.flatMap((template) => template.blocks).forEach((block) => {
            expect(allowed).toContain(block.type);
        });
    });

    it('shape headers, lists and checklists the way the editor reads them', () => {
        templates.flatMap((template) => template.blocks).forEach((block) => {
            if (block.type === 'header') {
                expect(typeof block.data.text).toBe('string');
                expect([1, 2, 3]).toContain(block.data.level);
            }
            if (block.type === 'list') {
                expect(['ordered', 'unordered']).toContain(block.data.style);
                block.data.items.forEach((item) => expect(item).toEqual({ content: expect.any(String), items: [] }));
            }
            if (block.type === 'checklist') {
                block.data.items.forEach((item) => expect(item).toEqual({ text: expect.any(String), checked: false }));
            }
            if (block.type === 'callout') {
                expect(['warn', 'info']).toContain(block.data.tone);
            }
        });
    });

    it('leave every checklist item unticked', () => {
        const items = templates.flatMap((template) => template.blocks).filter((block) => block.type === 'checklist').flatMap((block) => block.data.items);
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((item) => item.checked === false)).toBe(true);
    });

    it('make the runbook the one that opens as a wiki, with numbered steps', () => {
        const wikis = templates.filter((template) => template.wiki);
        expect(wikis.map((template) => template.key)).toEqual(['runbook']);
        const steps = wikis[0].blocks.find((block) => block.type === 'list');
        expect(steps.data.style).toBe('ordered');
    });

    it('give the spec its acceptance criteria as a checklist of three', () => {
        const spec = templates.find((template) => template.key === 'spec');
        const at = spec.blocks.findIndex((block) => block.type === 'header' && block.data.text === 'Acceptance criteria');
        expect(spec.blocks[at + 1].type).toBe('checklist');
        expect(spec.blocks[at + 1].data.items).toHaveLength(3);
    });

    it('keep the apostrophe in the retro heading plain', () => {
        const retro = templates.find((template) => template.key === 'retro');
        expect(retro.blocks.some((block) => block.data.text === "Didn't")).toBe(true);
    });

    it('never share one block object between two templates', () => {
        const blocks = templates.flatMap((template) => template.blocks);
        expect(new Set(blocks).size).toBe(blocks.length);
    });
});
