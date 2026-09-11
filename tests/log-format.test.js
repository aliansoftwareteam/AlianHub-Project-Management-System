const requestContext = require('../Config/requestContext');
const telemetry = require('../Config/telemetry');
const { formatFor } = require('../Config/logFormat');

const MESSAGE = Symbol.for('message');
const render = (kind, info = {}) => formatFor(kind).transform({ level: 'info', message: 'hello', ...info })[MESSAGE];

describe('log lines', () => {
    it('text lines carry the trace id beside the request id', () => {
        requestContext.run({ id: 'req-1' }, () => {
            const line = render('text');
            const traceId = telemetry.traceIdNow();
            expect(traceId).toMatch(/^[0-9a-f]{32}$/);
            expect(line).toMatch(new RegExp(`^\\S+ \\[log\\] info: \\[req-1\\] \\[trace=${traceId}\\] hello$`));
        });
    });

    it('a run pinned to its trace logs that trace id', () => {
        const traceId = telemetry.newTraceId();
        expect(telemetry.withTrace(traceId, () => render('text'))).toContain(`[trace=${traceId}]`);
    });

    it('outside a request a text line looks as it did before', () => {
        expect(render('text')).toMatch(/^\S+ \[log\] info: hello$/);
    });

    it('LOG_FORMAT=json writes one JSON record per line', () => {
        requestContext.run({ id: 'req-2' }, () => {
            const line = render('json');
            expect(line).not.toContain('\n');
            expect(JSON.parse(line)).toEqual({ ts: expect.any(String), level: 'info', label: 'log', requestId: 'req-2', traceId: telemetry.traceIdNow(), message: 'hello' });
        });
        expect(JSON.parse(render('JSON'))).toMatchObject({ requestId: null, traceId: null });
    });

    it('defaults to text and reads LOG_FORMAT when no kind is given', () => {
        const before = process.env.LOG_FORMAT;
        try {
            delete process.env.LOG_FORMAT;
            expect(render(undefined)).toMatch(/\[log\] info: hello$/);
            process.env.LOG_FORMAT = 'json';
            expect(JSON.parse(render(undefined)).message).toBe('hello');
        } finally {
            if (before === undefined) delete process.env.LOG_FORMAT; else process.env.LOG_FORMAT = before;
        }
    });
});
