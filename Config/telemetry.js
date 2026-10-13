const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');
const api = require('@opentelemetry/api');
const requestContext = require('./requestContext');

const TRACER_NAME = 'alianhub';
const TRACE_ID = /^[0-9a-f]{32}$/;
const INVALID_TRACE_ID = '0'.repeat(32);

let sdk = null;

const newTraceId = () => crypto.randomBytes(16).toString('hex');
const newSpanId = () => crypto.randomBytes(8).toString('hex');
const isTraceId = (value) => typeof value === 'string' && TRACE_ID.test(value) && value !== INVALID_TRACE_ID;
const isActive = () => Boolean(sdk);

/* OTel drops null attribute values with a diagnostic warning on every span. */
const cleanAttributes = (attributes) => Object.fromEntries(Object.entries(attributes || {}).filter(([, v]) => v !== null && v !== undefined));

const tracesUrl = (endpoint) => `${endpoint.replace(/\/+$/, '')}/v1/traces`;

function start(env = process.env) {
    if (sdk) return true;
    const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
    if (!endpoint) return false;
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
    sdk = new NodeSDK({
        serviceName: env.OTEL_SERVICE_NAME || 'alianhub',
        traceExporter: new OTLPTraceExporter({ url: tracesUrl(endpoint) }),
        instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new MongoDBInstrumentation()],
    });
    sdk.start();
    require('./processGuards').onFatal('telemetry', flush);
    return true;
}

/* index.js calls this before anything else is required, and so before it loads
 * .env: auto-instrumentation only patches modules required after the SDK starts.
 * The file is parsed without applyEnv, whose config and AWS requires would load first. */
function boot(envPath = path.join(__dirname, '..', '.env')) {
    const fromFile = fs.existsSync(envPath) ? require('dotenv').parse(fs.readFileSync(envPath)) : {};
    return start({ ...fromFile, ...process.env });
}

async function stop() {
    if (!sdk) return;
    const running = sdk;
    sdk = null;
    await running.shutdown();
}

async function flush() {
    if (!sdk) return;
    const provider = api.trace.getTracerProvider();
    const delegate = typeof provider.getDelegate === 'function' ? provider.getDelegate() : provider;
    if (delegate && typeof delegate.forceFlush === 'function') await delegate.forceFlush();
}

const activeTraceId = () => {
    const span = api.trace.getActiveSpan();
    const id = span && span.spanContext().traceId;
    return isTraceId(id) ? id : '';
};

/* Without the SDK the id lives on the request context, created on first use, so
 * every log line and row written for one request or run shares it. */
function traceIdNow() {
    if (sdk) {
        const id = activeTraceId();
        if (id) return id;
    }
    const store = requestContext.get();
    if (!store) return '';
    if (!isTraceId(store.traceId)) store.traceId = newTraceId();
    return store.traceId;
}

/* Re-enters a trace that started elsewhere: a run resumed by an approval, or an
 * automation step running from a queued job. */
function withTrace(traceId, fn) {
    if (!isTraceId(traceId)) return fn();
    const enter = () => requestContext.run({ ...(requestContext.get() || {}), traceId }, fn);
    if (!sdk || activeTraceId() === traceId) return enter();
    const parent = api.trace.setSpanContext(api.context.active(), { traceId, spanId: newSpanId(), traceFlags: api.TraceFlags.SAMPLED, isRemote: true });
    return api.context.with(parent, enter);
}

const handleFor = ({ traceId, spanId, attributes, span }) => {
    const recorded = cleanAttributes(attributes);
    return {
        traceId,
        spanId,
        attributes: recorded,
        setAttributes(more) {
            const clean = cleanAttributes(more);
            Object.assign(recorded, clean);
            if (span) span.setAttributes(clean);
        },
    };
};

/* The innermost span handle of the current async context, so a module deep
 * under withSpan (the spend meter, say) can add what it learns to the span its
 * caller opened without that caller passing the handle down. */
const openSpans = new AsyncLocalStorage();

const current = () => openSpans.getStore() || null;

/** Adds attributes to the innermost open span; no-op outside one. */
function setAttributes(attributes) {
    const handle = current();
    if (handle) handle.setAttributes(attributes);
    return Boolean(handle);
}

function withSpan(name, attributes, fn) {
    if (!sdk) {
        const handle = handleFor({ traceId: traceIdNow(), spanId: newSpanId(), attributes });
        return openSpans.run(handle, () => fn(handle));
    }
    return api.trace.getTracer(TRACER_NAME).startActiveSpan(name, { attributes: cleanAttributes(attributes) }, async (span) => {
        const { traceId, spanId } = span.spanContext();
        try {
            const handle = handleFor({ traceId, spanId, attributes, span });
            return await openSpans.run(handle, () => fn(handle));
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: api.SpanStatusCode.ERROR, message: error && error.message });
            throw error;
        } finally {
            span.end();
        }
    });
}

module.exports = { start, boot, stop, flush, isActive, traceIdNow, withTrace, withSpan, setAttributes, currentSpan: current, newTraceId, newSpanId, isTraceId };
