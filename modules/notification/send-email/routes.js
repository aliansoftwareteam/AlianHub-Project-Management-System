
const ctrl  = require("./controller");
const ctrlV2  = require("./controllerV2");
exports.init = (app) => {
    
        /**
    * @swagger
    *  components:
    *    schemas:
    *      single-notification-email:
    *        type: object
    *        required:
    *          - companyId
    *          - key
    *          - projectId
    *          - message
    *          - userId
    *          - notification
    *        properties:
    *         companyId:
    *           type: string
    *           required: true
    *           description: This is the dcoument id of selected company.
    *         key:
    *           type: string
    *           required: true
    *           description: This is the type of notification like project or tasks.
    *         message:
    *           type: string
    *           required: true
    *           description: This is the message for the notification.
    *         projectId:
    *           type: string
    *           required: true
    *           description: This is the project ID of notification.
    *         userId:
    *           type: string
    *           required: true
    *           description: This is the user id of user collections.
    *         userId:
    *           type: string
    *           required: true
    *           description: This is the notification objects of notification collections.
    */


      /**
     * @swagger
     *  /api/v2/single-notification-email:
     *    post: 
     *      description: This API is used to create a notification ap per receiver.
     *      tags: [Notifications]
     *      summary: Create Notification
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/single-notification-email'
     *      responses:
     *          "200":
     *              description: status:true/false,message:message
     */
    app.post('/api/v2/single-notification-email', ctrlV2.sendEmailHandlerSingleApi);
};