import { describe, expect, it } from 'vitest';
import { ACT, PROPOSE, decideForRating, previewActions, splitPreview } from '@/views/Ai/policyPreview';

const safe = { write: true, reversible: true, scope: 'task', money: false };

describe('decideForRating', () => {
    it('reads always act', () => {
        expect(decideForRating({ write: false, reversible: false, scope: 'workspace', money: true })).toEqual({ decision: ACT, reason: 'read' });
        expect(decideForRating(undefined, { key: 'task.get', write: false })).toEqual({ decision: ACT, reason: 'read' });
    });

    it('acts on a reversible task-scoped write that moves no money', () => {
        expect(decideForRating(safe)).toEqual({ decision: ACT, reason: 'safe' });
    });

    it('proposes an irreversible write', () => {
        expect(decideForRating({ ...safe, reversible: false })).toEqual({ decision: PROPOSE, reason: 'irreversible' });
    });

    it('proposes a write that reaches beyond one task', () => {
        expect(decideForRating({ ...safe, scope: 'project' })).toEqual({ decision: PROPOSE, reason: 'scope' });
        expect(decideForRating({ ...safe, scope: 'workspace' })).toEqual({ decision: PROPOSE, reason: 'scope' });
    });

    it('proposes anything that moves money, whatever else it is', () => {
        expect(decideForRating({ ...safe, money: true })).toEqual({ decision: PROPOSE, reason: 'money' });
    });

    it('proposes a write the registry has not rated yet', () => {
        expect(decideForRating(undefined, { key: 'task.comment', write: true })).toEqual({ decision: PROPOSE, reason: 'unrated' });
        expect(decideForRating(null, { key: 'task.comment' })).toEqual({ decision: PROPOSE, reason: 'unrated' });
    });
});

describe('previewActions / splitPreview', () => {
    const registry = [
        { key: 'task.get', label: 'Read a task brief', write: false, rating: { write: false, reversible: false, scope: 'task', money: false } },
        { key: 'task.comment', label: 'Comment on a task', write: true, rating: safe },
        { key: 'task.sprint.move', label: 'Move a task between sprints', write: true, rating: { ...safe, scope: 'project' } },
        { key: 'chat.post', label: 'Post in a channel', write: true, rating: { ...safe, reversible: false } },
        { key: 'deploy.staging', label: 'Propose a staging deploy', write: true, proposeOnly: true, rating: { write: true, reversible: false, scope: 'workspace', money: false } }
    ];

    it('keeps registry order, drops actions the agent may not use and unknown keys', () => {
        const items = previewActions(['chat.post', 'task.comment', 'not.registered'], registry);
        expect(items.map((i) => i.key)).toEqual(['task.comment', 'chat.post']);
        expect(items[0]).toMatchObject({ label: 'Comment on a task', decision: ACT, reason: 'safe' });
        expect(items[1]).toMatchObject({ decision: PROPOSE, reason: 'irreversible' });
    });

    it('splits into what acts and what is proposed', () => {
        const { acts, proposes } = splitPreview(registry.map((a) => a.key), registry);
        expect(acts.map((i) => i.key)).toEqual(['task.get', 'task.comment']);
        expect(proposes.map((i) => `${i.key}:${i.reason}`)).toEqual(['task.sprint.move:scope', 'chat.post:irreversible', 'deploy.staging:irreversible']);
    });

    it('tolerates an empty registry or allow-list', () => {
        expect(splitPreview([], registry)).toEqual({ acts: [], proposes: [] });
        expect(splitPreview(['task.get'], undefined)).toEqual({ acts: [], proposes: [] });
    });
});
