const { sendFcmNotificationsHandler } = require("./controllerV2");

exports.init = (app) => {

    /**
 * @swagger
 *  components:
 *    schemas:
 *      send-fcm:
 *        type: object
 *        description: The company is the caller's session company and the sender is the caller; companyId or senderUserDetail in the body is ignored.
 *        required:
 *          - userIdArray
 *          - key
 *          - message
 *          - type
 *          - actionUrl
 *        properties:
 *          userIdArray:
 *            type: array
 *            items:
 *              type: string
 *            description: User IDs to notify. Only active members of the session company are sent a push.
 *            example: ["user123", "user456"]
 *          key:
 *            type: string
 *            description: Notification key identifier (e.g., "comments_I'm_@mentioned_in")
 *            example: "comments_I'm_@mentioned_in"
 *          message:
 *            type: string
 *            description: Notification message content
 *            example: "You have been mentioned in a comment"
 *          type:
 *            type: string
 *            description: Type of notification (e.g., project, task, comment)
 *            example: "comment"
 *          actionUrl:
 *            type: string
 *            description: URL path for notification click action
 *            example: "projects/123/tasks/456"
 */

/**
 * @swagger
 *  /api/v1/send-fcm:
 *    post:
 *      description: Sends an FCM push to the listed members of the session company whose notification settings allow it. The answer is the same whether or not anyone was sent a push.
 *      tags: [Notifications]
 *      summary: Send FCM Push Notification
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/send-fcm'
 *      responses:
 *        "200":
 *          description: Request accepted
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  success:
 *                    type: boolean
 *                    example: true
 *                  message:
 *                    type: string
 *                    example: "Notification processed"
 *        "400":
 *          description: Bad request - validation error
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  success:
 *                    type: boolean
 *                    example: false
 *                  error:
 *                    type: string
 *                    example: "userIdArray must be a non-empty array"
 *        "403":
 *          description: The request names a company the caller's session does not belong to
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  success:
 *                    type: boolean
 *                    example: false
 *                  error:
 *                    type: string
 */

  app.post('/api/v1/send-fcm',sendFcmNotificationsHandler);

};