import { describe, expect, it } from 'vitest';
import { aiErrorKey, payloadOf } from '@/components/organisms/TaskDetailOverlay/aiErrors';

describe('aiErrorKey', () => {
    it('maps each known refusal code to its own sentence', () => {
        expect(aiErrorKey({ code: 'ai_off' })).toBe('TaskAi.ai_off');
        expect(aiErrorKey({ code: 'unconfigured' })).toBe('TaskAi.unconfigured');
        expect(aiErrorKey({ code: 'task_not_found' })).toBe('TaskAi.not_found');
    });

    it('reads an unrecognised code as a plain failure', () => {
        expect(aiErrorKey({ code: 'rate_limited' })).toBe('TaskAi.failed');
    });

    it('reads a missing payload or code as a plain failure', () => {
        expect(aiErrorKey()).toBe('TaskAi.failed');
        expect(aiErrorKey(null)).toBe('TaskAi.failed');
        expect(aiErrorKey({})).toBe('TaskAi.failed');
    });

    it('uses the caller fallback when the code is unknown', () => {
        expect(aiErrorKey({ code: 'nope' }, 'TaskAi.custom')).toBe('TaskAi.custom');
        expect(aiErrorKey({ code: 'ai_off' }, 'TaskAi.custom')).toBe('TaskAi.ai_off');
    });
});

describe('payloadOf', () => {
    it('returns the body the server answered with', () => {
        expect(payloadOf({ response: { data: { code: 'ai_off' } } })).toEqual({ code: 'ai_off' });
    });

    it('returns an empty body when the request never got an answer', () => {
        expect(payloadOf(new Error('Network Error'))).toEqual({});
        expect(payloadOf(undefined)).toEqual({});
        expect(payloadOf({ response: {} })).toEqual({});
    });

    it('feeds straight into aiErrorKey for an offline failure', () => {
        expect(aiErrorKey(payloadOf(new Error('timeout')))).toBe('TaskAi.failed');
    });
});
