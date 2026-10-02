const {
    failureReason, failuresOf, describeFailures, logUploadFailures,
} = require('../Modules/storage/uploadFailures');

describe('failureReason', () => {
    test('uses the S3 code and the http status when the error has them', () => {
        const error = Object.assign(new Error('Access Denied'), { Code: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        expect(failureReason(error)).toEqual({ code: 'AccessDenied', status: 403, message: 'Access Denied' });
    });

    test('falls back to code, then to the error name, then to "Error"', () => {
        expect(failureReason(Object.assign(new Error('x'), { code: 'ECONNRESET' })).code).toBe('ECONNRESET');
        const named = new Error('x');
        named.name = 'TimeoutError';
        expect(failureReason(named).code).toBe('TimeoutError');
        expect(failureReason(new Error('x')).code).toBe('Error');
    });

    test('no status key is present when there is no status', () => {
        expect('status' in failureReason(new Error('x'))).toBe(false);
    });

    test('a presigned address in the message loses its query string, so no signature reaches the log', () => {
        const error = new Error('PUT https://bucket.s3.example.com/file.png?X-Amz-Signature=secret&X-Amz-Credential=key failed');
        const { message } = failureReason(error);
        expect(message).toBe('PUT https://bucket.s3.example.com/file.png failed');
        expect(message).not.toContain('secret');
    });

    test('a fragment is cut as well, and every address in the message is cleaned', () => {
        const { message } = failureReason(new Error('a http://x.test/a?k=1 b https://y.test/b#frag'));
        expect(message).toBe('a http://x.test/a b https://y.test/b');
    });

    test('a thrown string is used as the message; null says unknown error', () => {
        expect(failureReason('boom').message).toBe('boom');
        expect(failureReason(null)).toEqual({ code: 'Error', message: 'unknown error' });
        expect(failureReason(undefined).message).toBe('unknown error');
    });
});

describe('failuresOf', () => {
    const items = [{ path: 'a.png' }, { path: 'b.png' }, { path: 'c.png' }];

    test('lists only the files that were rejected, with the file path', () => {
        const results = [
            { status: 'fulfilled', value: 1 },
            { status: 'rejected', reason: Object.assign(new Error('nope'), { code: 'E1' }) },
            { status: 'rejected', reason: new Error('late') },
        ];
        expect(failuresOf(items, results)).toEqual([
            { file: 'b.png', code: 'E1', message: 'nope' },
            { file: 'c.png', code: 'Error', message: 'late' },
        ]);
    });

    test('when every upload worked there is nothing to report', () => {
        expect(failuresOf(items, items.map(() => ({ status: 'fulfilled' })))).toEqual([]);
        expect(failuresOf([], [])).toEqual([]);
    });
});

describe('describeFailures', () => {
    test('puts the code, the status and the message on one line per file', () => {
        expect(describeFailures([
            { file: 'a.png', code: 'AccessDenied', status: 403, message: 'Denied' },
            { file: 'b.png', code: 'Error', message: 'late' },
        ])).toBe('a.png (AccessDenied 403: Denied); b.png (Error: late)');
    });

    test('no failures give an empty line', () => {
        expect(describeFailures([])).toBe('');
    });
});

describe('logUploadFailures', () => {
    test('logs one error that carries the detail, and returns the failures', () => {
        const logger = { error: jest.fn() };
        const failures = logUploadFailures(logger, [{ path: 'a.png' }], [{ status: 'rejected', reason: new Error('nope') }]);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith('Some uploads failed: a.png (Error: nope)');
        expect(failures).toHaveLength(1);
    });

    test('logs nothing when every upload worked', () => {
        const logger = { error: jest.fn() };
        expect(logUploadFailures(logger, [{ path: 'a.png' }], [{ status: 'fulfilled' }])).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
    });
});
