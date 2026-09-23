const { sendFcmNotificationsHandler } = require("./controllerV2");

exports.init = (app) => {

    /**
 * @swagger
 *  components:
 *    schemas:
 *      send-fcm:
 *        type: object
 *        required:
 *          - userIdArray
 *          - key
 *          - companyId
 *          - message
 *          - type
 *          - senderUserDetail
 *          - actionUrl
 *        properties:
 *          userIdArray:
 *            type: array
 *            items:
 *              type: string
 *            description: Array of user IDs to receive the notification
 *            example: ["user123", "user456"]
 *          key:
 *            type: string
 *            description: Notification key identifier (e.g., "comments_I'm_@mentioned_in")
 *            example: "comments_I'm_@mentioned_in"
 *          companyId:
 *            type: string
 *            description: Company document ID
 *            example: "company123"
 *          message:
 *            type: string
 *            description: Notification message content
 *            example: "You have been mentioned in a comment"
 *          type:
 *            type: string
 *            description: Type of notification (e.g., project, task, comment)
 *            example: "comment"
 *          senderUserDetail:
 *            type: object
 *            description: Details of the user sending the notification
 *            properties:
 *              Employee_Name:
 *                type: string
 *                description: Name of the sender
 *                example: "John Doe"
 *            example: { "Employee_Name": "John Doe" }
 *          actionUrl:
 *            type: string
 *            description: URL path for notification click action
 *            example: "projects/123/tasks/456"
 */

/**
 * @swagger
 *  /api/v1/send-fcm:
 *    post:
 *      description: This API is used to send FCM (Firebase Cloud Messaging) push notifications to eligible users based on their notification settings.
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
 *          description: Notification sent successfully
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
 *                    example: "Notification sent successfully"
 *                  response:
 *                    type: object
 *                    properties:
 *                      successCount:
 *                        type: integer
 *                        example: 5
 *                      failureCount:
 *                        type: integer
 *                        example: 0
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
 *        "500":
 *          description: Internal server error
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
 *                    example: "Failed to send FCM notification"
 */

  app.post('/api/v1/send-fcm',sendFcmNotificationsHandler);

};