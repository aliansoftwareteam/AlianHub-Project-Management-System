import { afterEach, describe, expect, it } from 'vitest';
import { leaveAskHandoff, takeAskHandoff } from '@/components/molecules/AdvanceSearch/askHandoff';

afterEach(() => sessionStorage.clear());

describe('the answer handed from the palette to the Ask page', () => {
    it('is taken once, for the same question only', () => {
        leaveAskHandoff('budget', { answer: 'On track' });
        expect(takeAskHandoff('other')).toBeNull();
        expect(takeAskHandoff(' budget ')).toEqual({ answer: 'On track' });
        expect(takeAskHandoff('budget')).toBeNull();
    });

    it('survives unreadable storage', () => {
        sessionStorage.setItem('alianhub.ask.handoff', '{not json');
        expect(takeAskHandoff('budget')).toBeNull();
    });
});
