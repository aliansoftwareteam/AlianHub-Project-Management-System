const hostingMode = require('../Config/hostingMode');
const { isBillingPath, closeBillingWhenHosted } = require('../Config/billingRoutes');

const savedMode = process.env.HOSTING_MODE;
const inMode = (mode) => {
    hostingMode._resetForTests();
    if (mode) process.env.HOSTING_MODE = mode; else delete process.env.HOSTING_MODE;
};
afterAll(() => inMode(savedMode));

const run = (path) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    const next = jest.fn();
    closeBillingWhenHosted({ path }, res, next);
    return { res, next };
};

describe('the old in-app billing routes', () => {
    it.each([
        '/api/v2/createSubscriptionChargebee', '/api/v1/cancleSubscriptionChargebee', '/api/v2/createCustomerChargbee', '/api/v1/customerAddressPaddle',
        '/api/v1/getSubscription', '/api/v1/getpaymentCustomer', '/api/v1/payPendingInvoice', '/api/v1/promotional-credit', '/api/v1/getInvoicePDF/123',
    ])('include %s', (path) => {
        expect(isBillingPath(path)).toBe(true);
    });

    it.each(['/api/v2/instance/settings', '/api/v1/getSubscriptionPlans', '/api/v1/project/billing', '/paddle.html', '/api/v2/plan/usage'])('leave %s alone', (path) => {
        expect(isBillingPath(path)).toBe(false);
    });

    it('answer 404 on a hosted instance', () => {
        inMode('managed');
        const { res, next } = run('/api/v2/createSubscriptionChargebee');
        expect(res.statusCode).toBe(404);
        expect(next).not.toHaveBeenCalled();
        expect(run('/api/v2/instance/settings').next).toHaveBeenCalled();
    });

    it('pass through on a self-hosted instance, as before', () => {
        inMode('');
        expect(run('/api/v2/createSubscriptionChargebee').next).toHaveBeenCalled();
    });
});
