import { describe, expect, it } from 'vitest';
import * as env from '@/config/env';

describe('the web app has no generic history or notification route', () => {
    it('defines neither route', () => {
        expect(env.HANDLE_HISTORY).toBeUndefined();
        expect(env.HANDLE_NOTIFICATION).toBeUndefined();
    });
});
