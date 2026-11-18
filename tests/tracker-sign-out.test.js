const { createSignOut, signInRefused } = require('../time-tracker-app/renderer/utils/signOut');

const refusal = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
const SESSION_GONE = refusal(401, { isJwtError: true, isRefreshTokenError: true, isLogout: true });

const setUp = ({ remaining = 0, endServerSession = jest.fn(async () => ({ status: 200 })), replayQueue } = {}) => {
    const calls = {
        replayQueue: replayQueue || jest.fn(async () => ({ sent: 0, dropped: 0, remaining })),
        endServerSession,
        endLocalSession: jest.fn(),
        holdForQueue: jest.fn(),
    };
    return { calls, signOut: createSignOut(calls) };
};

describe('when the desktop tracker signs out', () => {
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    it('ends the session on the server and here', async () => {
        const { calls, signOut } = setUp();
        await signOut();
        expect(calls.endServerSession).toHaveBeenCalledTimes(1);
        expect(calls.endLocalSession).toHaveBeenCalledTimes(1);
        expect(calls.holdForQueue).not.toHaveBeenCalled();
    });

    it.each([
        ['refuses it because the session is gone', SESSION_GONE],
        ['says the sign-in expired', refusal(401, { isJwtError: true })],
        ['cannot be reached', Object.assign(new Error('Network Error'), { request: {} })],
    ])('still ends the session here when the server %s', async (_label, error) => {
        const { calls, signOut } = setUp({ endServerSession: jest.fn(async () => { throw error; }) });
        await signOut();
        expect(calls.endLocalSession).toHaveBeenCalledTimes(1);
    });

    it('keeps the session and shows the queue while tracked time is still waiting to be sent', async () => {
        const { calls, signOut } = setUp({ remaining: 2 });
        await signOut();
        expect(calls.holdForQueue).toHaveBeenCalledTimes(1);
        expect(calls.endServerSession).not.toHaveBeenCalled();
        expect(calls.endLocalSession).not.toHaveBeenCalled();
    });

    it('joins the sign-out already running when a refused request asks for another', async () => {
        let signOut;
        const replayQueue = jest.fn(async () => {
            signOut();
            signOut();
            return { sent: 0, dropped: 0, remaining: 0 };
        });
        const set = setUp({ replayQueue, endServerSession: jest.fn(async () => { signOut(); throw SESSION_GONE; }) });
        signOut = set.signOut;
        await signOut();
        expect(replayQueue).toHaveBeenCalledTimes(1);
        expect(set.calls.endServerSession).toHaveBeenCalledTimes(1);
        expect(set.calls.endLocalSession).toHaveBeenCalledTimes(1);
    });

    it('gives every caller during one sign-out the same answer', async () => {
        const { calls, signOut } = setUp();
        const first = signOut();
        expect(signOut()).toBe(first);
        await first;
        expect(calls.endServerSession).toHaveBeenCalledTimes(1);
    });

    it('can sign out again once the last sign-out finished', async () => {
        const { calls, signOut } = setUp();
        await signOut();
        await signOut();
        expect(calls.endServerSession).toHaveBeenCalledTimes(2);
    });

    it('settles even when sending the queue fails', async () => {
        const { calls, signOut } = setUp({ replayQueue: jest.fn(async () => { throw new Error('storage unavailable'); }) });
        await expect(signOut()).resolves.toBeUndefined();
        expect(calls.endLocalSession).not.toHaveBeenCalled();
        await signOut();
        expect(calls.replayQueue).toHaveBeenCalledTimes(2);
    });
});

describe('when queued time is sent and the server refuses it', () => {
    it.each([
        ['the session is gone', SESSION_GONE],
        ['the sign-in expired', refusal(401, { isJwtError: true })],
        ['the session expired during a refresh', refusal(400, { message: 'Your session is expired', isLogout: true })],
    ])('keeps it for the next sign-in when %s', (_label, error) => {
        expect(signInRefused(error)).toBe(true);
    });

    it.each([
        ['a request the server will never accept', refusal(400, { status: false, statusText: 'Invalid input' })],
        ['a refusal with no body', refusal(403, undefined)],
        ['a lost connection', Object.assign(new Error('Network Error'), { request: {} })],
        ['no error at all', undefined],
    ])('does not call %s a refused sign-in', (_label, error) => {
        expect(signInRefused(error)).toBe(false);
    });
});
