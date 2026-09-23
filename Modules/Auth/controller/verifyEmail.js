const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');

const VERIFICATION_TOKEN_TTL_MIN = 10;

/* Unknown, already verified and expired accounts get the same answer, and it never carries
 * the address, so a guessed account id reveals nothing. */
const LINK_NOT_VALID = Object.freeze({
    status: false,
    statusText: 'This link is invalid or has expired.',
    showResendVerification: true,
});

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
            if (!response || response.isEmailVerified === true) {
                res.send({ ...LINK_NOT_VALID });
                return;
            }

            const storedToken = response.verificationToken;
            // An empty stored token is what a used or never-started verification leaves; it matches nothing.
            if (typeof storedToken !== 'string' || storedToken.length === 0) {
                res.send({ ...LINK_NOT_VALID });
                return;
            }

            // A missing or unreadable issue time counts as expired.
            const rawTime = response.verificationTokenTime
                ? new Date(response.verificationTokenTime)
                : null;
            const hasValidTime = rawTime && !Number.isNaN(rawTime.getTime());
            const validUntil = hasValidTime
                ? new Date(rawTime.getTime() + VERIFICATION_TOKEN_TTL_MIN * 60 * 1000)
                : null;
            if (!validUntil || validUntil < new Date() || storedToken !== req.body.token) {
                res.send({ ...LINK_NOT_VALID });
                return;
            }

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
        }).catch(() => {
            res.send({ ...LINK_NOT_VALID });
        });
    } catch (error) {
        res.send({
            status: false,
            statusText: error.message,
        });
    }
};
