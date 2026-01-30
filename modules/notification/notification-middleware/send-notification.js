const config = require('../../../Config/config');
const { fcm } = require('../../../Config/firebaseConfig');

const logger = require("../../../Config/loggerConfig")
exports.sendFCMNotification = ({notification, tokens, msgData}) => {
    return new Promise(async (resolve, reject) => {
        try {
            // Check if FCM is initialized
            if (!fcm) {
                console.error('FCM is not initialized!');
                return reject({status: false, message: 'FCM not initialized'});
            }
            
            const response = await fcm.sendEachForMulticast({data: notification, tokens: tokens}).catch((error) => {
                console.error(error,'ERORR:');
            })
            resolve({
                status: true,
                successCount: response.successCount,
                failureCount: response.failureCount,
                responses: response.responses
            });
        } catch (error) {
            resolve({status:true})
        }
    })
}