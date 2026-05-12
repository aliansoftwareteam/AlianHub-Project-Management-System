
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');

// BUG-014 / #68 fix: window in minutes the verification token is valid for.
const VERIFICATION_TOKEN_TTL_MIN = 10;

/**
 * Verify Email
 *
 * Pre-fix this controller had three subtle problems that combined into a
 * verification bypass:
 *
 *   1. Input validation at lines 12–26 used `!req.body.token`, which lets
 *      objects/arrays through (`![]` and `!{}` are `false`). So a JSON body
 *      of `{ token: [] }` passed validation.
 *
 *   2. The final branch `response.verificationToken == req.body.token`
 *      used JavaScript loose-equality. `"" == []` is `true`, so any account
 *      whose stored `verificationToken` is `""` (the value the codebase
 *      sets after a successful verification, or as a fresh-account default)
 *      could be re-verified by anyone who could send `{ uid, token: [] }`.
 *
 *   3. There was no fallback `else`, so unmatched states (e.g. stored
 *      token is `null`/undefined) silently fell off the end and left the
 *      request hanging.
 *
 * Also: the expiry check `new Date(verificationTokenTime).setMinutes(...)`
 * produced an `Invalid Date` when `verificationTokenTime` was missing, and
 * `InvalidDate < new Date()` is `false`, so the expiry check was bypassed
 * for any user without a valid `verificationTokenTime` field.
 *
 * The rewrite below:
 *   - Requires `uid` and `token` to be non-empty strings (rejects arrays,
 *     objects, numbers, etc.).
 *   - Requires the stored `verificationToken` to be a non-empty string.
 *   - Uses strict equality `===` for the token comparison.
 *   - Treats an invalid / missing `verificationTokenTime` as expired
 *     instead of silently bypassing the expiry.
 *   - Sends exactly one response in every branch (no fallthrough hang).
 */
exports.verifyEmail = (req, res) => {
    try {
        if (typeof req.body.uid !== 'string' || req.body.uid.length === 0) {
            res.send({
                status: false,
                statusText: 'uid is required.',
            });
            return;
        }
        if (typeof req.body.token !== 'string' || req.body.token.length === 0) {
            res.send({
                status: false,
                statusText: 'token is required.',
            });
            return;
        }

        const findUser = {
            type: dbCollections.USERS,
            data: [{ _id: req.body.uid }],
        };

        mongoRef.MongoDbCrudOpration('global', findUser, 'findOne').then((response) => {
            if (!response) {
                res.send({
                    status: false,
                    statusText: 'Couldn’t find your Account',
                    showResendVerification: false,
                });
                return;
            }

            // Already verified — clear any stale token and respond.
            if (response.isEmailVerified === true) {
                const clearTokenObj = {
                    type: dbCollections.USERS,
                    data: [
                        { _id: req.body.uid },
                        { $set: { verificationToken: '' } },
                    ],
                };
                mongoRef.MongoDbCrudOpration('global', clearTokenObj, 'findOneAndUpdate').then(() => {
                    res.send({
                        status: false,
                        alreadyVarified: true,
                        statusText: 'Your email is already verified',
                        showResendVerification: false,
                    });
                }).catch((error) => {
                    res.send({
                        status: false,
                        statusText: error.message,
                    });
                });
                return;
            }

            const storedToken = response.verificationToken;
            const expiredResponse = {
                status: false,
                email: response.Employee_Email,
                statusText: 'This link is expired',
                showResendVerification: true,
            };

            // Stored token must be a non-empty string. Empty string is what
            // the code stores after a successful verification or for fresh
            // accounts where verification hasn't been initiated yet — both
            // states should reject any incoming `token`, not match it.
            if (typeof storedToken !== 'string' || storedToken.length === 0) {
                res.send(expiredResponse);
                return;
            }

            // Treat a missing / invalid `verificationTokenTime` as expired
            // rather than silently bypassing the expiry.
            const rawTime = response.verificationTokenTime
                ? new Date(response.verificationTokenTime)
                : null;
            const hasValidTime = rawTime && !Number.isNaN(rawTime.getTime());
            const validUntil = hasValidTime
                ? new Date(rawTime.getTime() + VERIFICATION_TOKEN_TTL_MIN * 60 * 1000)
                : null;
            if (!validUntil || validUntil < new Date()) {
                res.send(expiredResponse);
                return;
            }

            // Strict equality — both are non-empty strings at this point.
            if (storedToken !== req.body.token) {
                res.send(expiredResponse);
                return;
            }

            // Success — mark the user verified and clear the token.
            const markVerifiedObj = {
                type: dbCollections.USERS,
                data: [
                    { _id: req.body.uid },
                    {
                        $set: {
                            verificationToken: '',
                            isEmailVerified: true,
                        },
                    },
                ],
            };
            mongoRef.MongoDbCrudOpration('global', markVerifiedObj, 'findOneAndUpdate').then(() => {
                res.send({
                    status: true,
                    statusText: 'Email verified successfully.',
                    showResendVerification: false,
                });
            }).catch((error) => {
                res.send({
                    status: false,
                    statusText: error.message,
                });
            });
        }).catch((error) => {
            res.send({
                status: false,
                statusText: error,
            });
        });
    } catch (error) {
        res.send({
            status: false,
            statusText: error.message,
        });
    }
};
