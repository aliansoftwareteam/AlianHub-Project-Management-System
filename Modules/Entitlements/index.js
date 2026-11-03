const entitlements = require('./entitlements');
const checks = require('./checks');
const answers = require('./answers');
const seats = require('./seats');
const uploads = require('./uploads');
const guards = require('./guards');
const lifecycleGuard = require('./lifecycleGuard');

module.exports = {
    ...checks,
    applyEntitlements: entitlements.applyEntitlements,
    bootEntitlements: entitlements.bootEntitlements,
    limits: entitlements.limits,
    feature: entitlements.feature,
    lifecycle: entitlements.lifecycle,
    planFeatureFor: entitlements.planFeatureFor,
    PLAN_EVENT: entitlements.PLAN_EVENT,
    refusalBody: answers.refusalBody,
    answerRefusal: answers.answerRefusal,
    isRefusalError: answers.isRefusalError,
    seatRefusal: seats.seatRefusal,
    forgetSeats: seats.forgetSeats,
    assertUploadAllowed: uploads.assertUploadAllowed,
    uploadLimitRefusal: uploads.uploadLimitRefusal,
    declaredUploadSize: uploads.declaredUploadSize,
    maxUploadBytes: uploads.maxUploadBytes,
    acceptanceRefusal: guards.acceptanceRefusal,
    requireInvitationSeats: guards.requireInvitationSeats,
    requireImportSeats: guards.requireImportSeats,
    requireWorkspaceRoom: guards.requireWorkspaceRoom,
    trackerSeatRefusal: guards.trackerSeatRefusal,
    trackerGate: guards.trackerGate,
    lifecycleGuard: lifecycleGuard.lifecycleGuard,
    writable: lifecycleGuard.writable,
    whenWritable: lifecycleGuard.whenWritable,
};
