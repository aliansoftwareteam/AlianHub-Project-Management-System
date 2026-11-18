import { beforeEach, describe, expect, it, vi } from 'vitest';

const { io } = vi.hoisted(() => ({ io: vi.fn() }));

vi.mock('socket.io-client', () => ({ io }));

import { socketHelper } from '@/composable/socketHelper';

beforeEach(() => {
    io.mockReset();
    io.mockImplementation(() => ({
        on: (event, cb) => { if (event === 'connect') cb(); },
    }));
});

describe('socketHelper', () => {
    it('sends cookies with the handshake and no token in auth', async () => {
        await socketHelper().connectServer('https://app.test', 'userid_u1', {});
        expect(io).toHaveBeenCalledTimes(1);
        expect(io.mock.calls[0][0]).toBe('https://app.test/userid_u1');
        expect(io.mock.calls[0][1]).toMatchObject({ withCredentials: true });
        expect(io.mock.calls[0][1].auth).toBeUndefined();
    });

    it('rejects a connect error', async () => {
        io.mockImplementation(() => ({ on: (event, cb) => { if (event === 'connect_error') cb(new Error('nope')); } }));
        await expect(socketHelper().connectServer('https://app.test', 'userid_u1', {})).rejects.toThrow('nope');
    });
});
