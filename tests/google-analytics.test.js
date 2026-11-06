const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../Config/loggerConfig', () => mockLogger);

const GA_SCRIPT = 'https://www.googletagmanager.com';
const GA_CONNECT = ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'];

const fresh = () => {
    jest.resetModules();
    mockLogger.warn.mockClear();
    return {
        ga: require('../Config/googleAnalytics'),
        csp: require('../Config/contentSecurityPolicy'),
    };
};

describe('GA_MEASUREMENT_ID', () => {
    test('unset leaves the policy exactly as it was and logs nothing', () => {
        const { ga, csp } = fresh();
        expect(ga.measurementIdOf({})).toBe('');
        expect(csp.policyOf({ GA_MEASUREMENT_ID: '' })).toBe(csp.policyOf({}));
        expect(csp.policyOf({})).not.toContain('googletagmanager');
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('a GA4 id adds the Google Analytics hosts to script-src and connect-src only', () => {
        const { ga, csp } = fresh();
        const env = { GA_MEASUREMENT_ID: ' g-abc123XYZ9 ' };
        expect(ga.measurementIdOf(env)).toBe('G-ABC123XYZ9');
        const without = csp.buildDirectives({});
        const withGa = csp.buildDirectives(env);
        expect(withGa['script-src']).toEqual([...without['script-src'], GA_SCRIPT]);
        expect(withGa['connect-src']).toEqual([...without['connect-src'], ...GA_CONNECT]);
        for (const name of csp.DIRECTIVE_NAMES.filter((n) => !['script-src', 'connect-src'].includes(n))) {
            expect(withGa[name]).toEqual(without[name]);
        }
    });

    test('a malformed id is treated as unset, warns once and never throws', () => {
        const { ga, csp } = fresh();
        const env = { GA_MEASUREMENT_ID: "UA-1234-1'; script-src *" };
        expect(() => csp.middleware({ ...env, CSP_MODE: 'enforce' })).not.toThrow();
        expect(csp.policyOf(env)).toBe(csp.policyOf({}));
        expect(ga.measurementIdOf(env)).toBe('');
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn.mock.calls[0][0]).toContain('GA_MEASUREMENT_ID');
    });

    test('an id GA and the CSP extras both name is listed once', () => {
        const { csp } = fresh();
        const sources = csp.buildDirectives({ GA_MEASUREMENT_ID: 'G-ABCDEF12', CSP_EXTRA_SCRIPT_SRC: GA_SCRIPT })['script-src'];
        expect(sources.filter((s) => s === GA_SCRIPT)).toHaveLength(1);
    });

    test('public config carries the id, empty when unset', () => {
        jest.resetModules();
        const saved = process.env.GA_MEASUREMENT_ID;
        try {
            delete process.env.GA_MEASUREMENT_ID;
            expect(require('../Config/instanceSettings').publicConfig().analytics).toEqual({ gaMeasurementId: '' });
            process.env.GA_MEASUREMENT_ID = 'G-ABCDEF12';
            expect(require('../Config/instanceSettings').publicConfig().analytics).toEqual({ gaMeasurementId: 'G-ABCDEF12' });
        } finally {
            if (saved === undefined) delete process.env.GA_MEASUREMENT_ID;
            else process.env.GA_MEASUREMENT_ID = saved;
        }
    });
});
