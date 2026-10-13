const mockSdks = [];

jest.mock('@opentelemetry/sdk-node', () => {
    const { trace, context } = jest.requireActual('@opentelemetry/api');
    const { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } = jest.requireActual('@opentelemetry/sdk-trace-base');
    const { AsyncLocalStorageContextManager } = jest.requireActual('@opentelemetry/context-async-hooks');
    const exporter = new InMemorySpanExporter();
    class NodeSDK {
        constructor(options) { this.options = options; mockSdks.push(this); }

        start() {
            trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
            context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
        }

        async shutdown() { trace.disable(); context.disable(); }
    }
    return { NodeSDK, exporter };
});
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: jest.fn() }));
jest.mock('@opentelemetry/instrumentation-http', () => ({ HttpInstrumentation: jest.fn() }));
jest.mock('@opentelemetry/instrumentation-express', () => ({ ExpressInstrumentation: jest.fn() }));
jest.mock('@opentelemetry/instrumentation-mongodb', () => ({ MongoDBInstrumentation: jest.fn() }));

const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const requestContext = require('../Config/requestContext');
const processGuards = require('../Config/processGuards');
const telemetry = require('../Config/telemetry');

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

describe('without an endpoint', () => {
    it('does not start the SDK', () => {
        expect(telemetry.start({})).toBe(false);
        expect(telemetry.start({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' })).toBe(false);
        expect(mockSdks).toHaveLength(0);
        expect(OTLPTraceExporter).not.toHaveBeenCalled();
        expect(telemetry.isActive()).toBe(false);
    });

    it('holds one W3C trace id per request context and none outside a request', () => {
        expect(telemetry.traceIdNow()).toBe('');
        const seen = requestContext.run({ id: 'req-1' }, () => [telemetry.traceIdNow(), telemetry.traceIdNow(), requestContext.requestId()]);
        expect(seen[0]).toMatch(TRACE_ID);
        expect(seen[1]).toBe(seen[0]);
        expect(seen[2]).toBe('req-1');
    });

    it('withTrace pins a trace id for the callback and keeps the request id', () => {
        const id = telemetry.newTraceId();
        expect(requestContext.run({ id: 'req-2' }, () => telemetry.withTrace(id, () => [telemetry.traceIdNow(), requestContext.requestId()]))).toEqual([id, 'req-2']);
        expect(telemetry.withTrace('not-a-trace', () => telemetry.traceIdNow())).toBe('');
    });

    it('withSpan just runs the callback with a span handle and passes errors through', async () => {
        const id = telemetry.newTraceId();
        const out = await telemetry.withTrace(id, () => telemetry.withSpan('agent.step gather', { 'agent.step.node': 'gather' }, async (span) => {
            span.setAttributes({ 'agent.step.status': 'ok' });
            return span;
        }));
        expect(out.traceId).toBe(id);
        expect(out.spanId).toMatch(SPAN_ID);
        expect(out.attributes).toEqual({ 'agent.step.node': 'gather', 'agent.step.status': 'ok' });
        expect(await telemetry.withSpan('plain', {}, () => 7)).toBe(7);
        await expect(telemetry.withSpan('boom', {}, async () => { throw new Error('provider down'); })).rejects.toThrow('provider down');
        await expect(telemetry.flush()).resolves.toBeUndefined();
    });
});

describe('with an endpoint', () => {
    afterEach(() => telemetry.stop());

    it('starts the SDK once, exporting over OTLP/HTTP with the default service name, and flushes it on a fatal exit', () => {
        const onFatal = jest.spyOn(processGuards, 'onFatal');
        expect(telemetry.start({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318/' })).toBe(true);
        expect(telemetry.start({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318/' })).toBe(true);
        expect(mockSdks).toHaveLength(1);
        expect(mockSdks[0].options.serviceName).toBe('alianhub');
        expect(mockSdks[0].options.instrumentations).toHaveLength(3);
        expect(OTLPTraceExporter).toHaveBeenCalledWith({ url: 'http://collector.test:4318/v1/traces' });
        expect(telemetry.isActive()).toBe(true);
        expect(onFatal).toHaveBeenCalledWith('telemetry', telemetry.flush);
        onFatal.mockRestore();
    });

    it('honours OTEL_SERVICE_NAME', async () => {
        telemetry.start({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318', OTEL_SERVICE_NAME: 'alianhub-worker' });
        expect(mockSdks[mockSdks.length - 1].options.serviceName).toBe('alianhub-worker');
    });

    it('withSpan records spans that nest under one trace, and traceIdNow reads the active span', async () => {
        telemetry.start({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318' });
        const { exporter } = require('@opentelemetry/sdk-node');
        exporter.reset();

        const seen = await telemetry.withSpan('outer', { 'agent.step.node': 'analyse', dropped: null }, (outer) => telemetry.withSpan('inner', {}, async (inner) => ({ outer, inner, now: telemetry.traceIdNow() })));
        expect(seen.outer.traceId).toMatch(TRACE_ID);
        expect(seen.inner.traceId).toBe(seen.outer.traceId);
        expect(seen.now).toBe(seen.outer.traceId);

        const spans = exporter.getFinishedSpans();
        expect(spans.map((s) => s.name)).toEqual(['inner', 'outer']);
        expect(spans[1].attributes).toEqual({ 'agent.step.node': 'analyse' });
        expect(spans[1].spanContext().spanId).toBe(seen.outer.spanId);

        await expect(telemetry.withSpan('boom', {}, async () => { throw new Error('no'); })).rejects.toThrow('no');
        expect(exporter.getFinishedSpans()[2].status.code).toBe(2);

        const pinned = telemetry.newTraceId();
        expect(await telemetry.withTrace(pinned, () => telemetry.withSpan('resumed', {}, async (span) => span.traceId))).toBe(pinned);
        await expect(telemetry.flush()).resolves.toBeUndefined();
    });
});
