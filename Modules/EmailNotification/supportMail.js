const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { SendEmail } = require('../service');
const logger = require('../../Config/loggerConfig');
const config = require('../../Config/config');

const MAX_MESSAGE_LENGTH = 5000;
const MAX_PRODUCT_LENGTH = 200;

const oneLine = (value, max) => String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

const senderOf = async (uid) => {
    if (!mongoose.Types.ObjectId.isValid(String(uid))) return null;
    return MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.USERS,
        data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }, { Employee_Name: 1, Employee_Email: 1 }],
    }, 'findOne');
};

/* The mailbox comes from the server's own configuration, never from the request, and the
 * mail names the signed-in sender, so this cannot be pointed at anyone else. */
exports.sendSupportMail = async (req, res) => {
    const refuse = (statusCode, statusText) => res.status(statusCode).send({ status: false, statusText });
    try {
        const mailbox = String(process.env.SUPPORT_MAIL || '').trim();
        if (!mailbox) return refuse(503, 'Support mail is not set up on this server.');
        const body = req.body || {};
        const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';
        if (!message) return refuse(400, 'A message is required.');

        const sender = await senderOf(req.uid);
        if (!(sender && sender._id)) return refuse(401, 'Unauthorized');
        const name = oneLine(sender.Employee_Name, 100) || 'A user';
        const email = oneLine(sender.Employee_Email, 200);
        const product = typeof body.productName === 'string' ? oneLine(body.productName, MAX_PRODUCT_LENGTH) : '';

        const appName = oneLine(config.APP_NAME, 60) || 'AlianHub';
        const subject = `${appName} support request from ${name}`;
        const header = [`From: ${name} <${email}>`, ...(product ? [`Product: ${product}`] : [])];
        const text = `${header.join('\n')}\n\n${message}`;

        SendEmail(subject, text, mailbox, false, (result) => {
            if (!(result && result.status)) {
                logger.error(`sendSupportMail: ${result && result.error}`);
                return refuse(502, 'The support mail could not be sent.');
            }
            return res.send({ status: true, statusText: 'Support mail sent.' });
        });
    } catch (error) {
        logger.error(`sendSupportMail: ${error.message || error}`);
        return refuse(400, 'The support mail could not be sent.');
    }
};
