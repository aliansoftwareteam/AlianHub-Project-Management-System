/* Why a workspace was not made. The page translates the code (Auth.workspace_reason_<code> in the locales) and
 * shows the sentence only for a code it does not know, so a code stays the same once it has shipped. */
const WORKSPACE_FAILURE = Object.freeze({
    INVALID_DETAILS: Object.freeze({ code: 'invalid_details', statusText: "Some of the workspace's details are missing or not valid." }),
    NOT_PREPARED: Object.freeze({ code: 'not_prepared', statusText: "The server could not set up the workspace's storage and starting settings." }),
    NOT_FINISHED: Object.freeze({ code: 'not_finished', statusText: 'The server could not finish making the workspace, so none of it was kept. Try again.' }),
    SERVER_ERROR: Object.freeze({ code: 'server_error', statusText: 'Something went wrong on the server.' }),
});

const failureReply = (failure, statusText = failure.statusText) => ({ status: false, code: failure.code, statusText });

module.exports = { WORKSPACE_FAILURE, failureReply };
