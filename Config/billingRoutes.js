const hostingMode = require('./hostingMode');

const PROVIDER = /chargebee|chargbee|paddle/i;
const BILLING_ENDPOINTS = [
    'getSubscription', 'getpaymentCustomer', 'getInvoicePDF', 'updateCustomerBilling', 'getCardDetails', 'createCustomerChargbee',
    'updateCardForSubscription', 'cancleSubscriptionPayment', 'getInvoiceAndCreditNotes', 'getInvoiceAndCreditNoteURL',
    'updateSubscriptionPaymentEstimate', 'updateSubscriptionPayment', 'addAndRemoveUserInPaymentSubscriptionEstimate',
    'addAndRemoveUserInPaymentSubscription', 'checkSubscriptionSchedule', 'removeSubscriptionScheduledChanges',
    'payPendingInvoice', 'getCustomerCredit', 'promotional-credit',
];
const ENDPOINT = new RegExp(`^/api/v[12]/(?:${BILLING_ENDPOINTS.join('|')})(?:/|$)`, 'i');

const isBillingPath = (path) => /^\/api\//.test(path) && (PROVIDER.test(path) || ENDPOINT.test(path));

/* A hosted plan is bought in the AlianHub account; the in-app Chargebee and Paddle billing a
 * private build may mount does not exist there. */
function closeBillingWhenHosted(req, res, next) {
    if (!hostingMode.isManaged() || !isBillingPath(req.path)) return next();
    return res.status(404).send({ status: false, statusText: 'Not found.' });
}

module.exports = { BILLING_ENDPOINTS, isBillingPath, closeBillingWhenHosted };
