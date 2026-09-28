import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import {
    actionLabel,
    autonomyAbout,
    autonomyName,
    humaniseKey,
    proposalTitle,
    skillAbout,
    skillLabel,
    sortProposals,
    waitingDaysOf
} from '@/views/Ai/plainLabels';

const { t } = createI18n({ legacy: false, locale: 'en', messages: { en } }).global;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-28T12:00:00Z').getTime();

describe('skillLabel', () => {
    it('names a built-in skill in words, whether given the key or a stored entry', () => {
        expect(skillLabel(t, 'pr.summary')).toBe('Summarise a pull request');
        expect(skillLabel(t, { key: 'brief.parse', name: 'brief.parse', source: 'code' })).toBe('Break a brief into subtasks');
        expect(skillLabel(t, { key: 'qa-review', name: 'QA Review', source: 'code' })).toBe('Check a page for defects');
    });

    it('names every skill key the templates can hand an agent', () => {
        ['brief.parse', 'project.plan', 'pr.summary', 'risk.flags', 'digest.ceo', 'risk.today', 'project.guide', 'qa-review'].forEach((key) => {
            const label = skillLabel(t, key);
            expect(label).not.toContain(key);
            expect(label).not.toMatch(/^Ai\./);
            expect(skillAbout(t, key)).not.toMatch(/^Ai\./);
        });
    });

    it('keeps the name a workspace gave its own skill', () => {
        expect(skillLabel(t, { key: 'release.notes', name: 'Draft release notes', source: 'data', description: 'Writes the notes.' })).toBe('Draft release notes');
        expect(skillAbout(t, { key: 'release.notes', name: 'Draft release notes', source: 'data', description: 'Writes the notes.' })).toBe('Writes the notes.');
    });

    it('turns an unknown key into words rather than showing it raw', () => {
        expect(skillLabel(t, { key: 'sprint.retro_notes', name: 'sprint.retro_notes' })).toBe('Sprint retro notes');
        expect(humaniseKey('ops-weekly.digest')).toBe('Ops weekly digest');
    });
});

describe('actionLabel', () => {
    const registry = [{ key: 'task.comment', label: 'Comment on a task' }];

    it('uses the registry label for an action', () => {
        expect(actionLabel(t, 'task.comment', registry)).toBe('Comment on a task');
        expect(actionLabel(t, { key: 'task.link', label: 'Attach a PR, branch or doc' })).toBe('Attach a PR, branch or doc');
    });

    it('names the never-list in words', () => {
        expect(actionLabel(t, 'project.delete')).toBe('Delete a project');
        expect(actionLabel(t, 'status.set("Done")')).toBe('Mark a task Done');
        expect(actionLabel(t, 'billing.*')).toBe('Anything to do with billing');
    });

    it('falls back to words for an action it has no label for', () => {
        expect(actionLabel(t, 'timelog.start')).toBe('Timelog start');
    });
});

describe('autonomy wording', () => {
    it('says what each level does without a level code', () => {
        expect(autonomyName(t, 0)).toBe('Answers and suggests');
        expect(autonomyName(t, 1)).toBe('Suggests changes');
        expect(autonomyName(t, 2)).toBe('Acts, you approve the rest');
        expect(autonomyName(t, 3)).toBe('Acts, also on a schedule');
        [0, 1, 2, 3].forEach((level) => {
            expect(autonomyName(t, level)).not.toMatch(/L\d|SUGGEST|GATED/);
            expect(autonomyAbout(t, level).length).toBeGreaterThan(20);
        });
    });

    it('reads an unknown level as the lowest', () => {
        expect(autonomyName(t, undefined)).toBe(autonomyName(t, 0));
        expect(autonomyName(t, 9)).toBe(autonomyName(t, 0));
    });
});

describe('proposalTitle', () => {
    it('names the skill and counts changes in the right number', () => {
        expect(proposalTitle(t, { what: 'pr.summary: 1 change(s) on AR-1' })).toBe('Summarise a pull request · 1 change on AR-1');
        expect(proposalTitle(t, { what: 'brief.parse: 7 change(s) on AP-116' })).toBe('Break a brief into subtasks · 7 changes on AP-116');
    });

    it('pluralises QA findings', () => {
        expect(proposalTitle(t, { what: 'File 1 QA finding(s) on AP-9' })).toBe('File 1 QA finding on AP-9');
        expect(proposalTitle(t, { what: 'File 3 QA finding(s) on AP-9' })).toBe('File 3 QA findings on AP-9');
    });

    it('leaves a title an agent wrote in words alone', () => {
        expect(proposalTitle(t, { what: 'Move the launch checklist to next sprint' })).toBe('Move the launch checklist to next sprint');
    });
});

describe('waitingDaysOf', () => {
    const at = (days) => new Date(NOW - days * DAY).toISOString();

    it('marks a pending proposal older than three days', () => {
        expect(waitingDaysOf({ status: 'pending', createdAt: at(18) }, NOW)).toBe(18);
        expect(waitingDaysOf({ status: 'pending', createdAt: at(3.5) }, NOW)).toBe(3);
    });

    it('does not mark a fresh or decided proposal', () => {
        expect(waitingDaysOf({ status: 'pending', createdAt: at(2) }, NOW)).toBe(0);
        expect(waitingDaysOf({ status: 'pending', createdAt: at(3) }, NOW)).toBe(0);
        expect(waitingDaysOf({ status: 'approved', createdAt: at(10) }, NOW)).toBe(0);
    });
});

describe('sortProposals', () => {
    const rows = [
        { _id: 'b', createdAt: '2026-09-20T00:00:00Z' },
        { _id: 'a', createdAt: '2026-09-27T00:00:00Z' },
        { _id: 'c', createdAt: '2026-09-10T00:00:00Z' }
    ];

    it('puts the newest first by default and the longest waiting first on request', () => {
        expect(sortProposals(rows).map((p) => p._id)).toEqual(['a', 'b', 'c']);
        expect(sortProposals(rows, 'oldest').map((p) => p._id)).toEqual(['c', 'b', 'a']);
        expect(rows.map((p) => p._id)).toEqual(['b', 'a', 'c']);
    });
});
