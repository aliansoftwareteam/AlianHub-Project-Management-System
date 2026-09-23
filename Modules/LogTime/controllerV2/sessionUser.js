const { actingUser } = require('../../Sprints/helpers/actingUser');

const refuse = (res, status, statusText) => {
    res.status(status).send({ status: false, statusText, message: statusText });
    return null;
};

/* The desktop tracker only ever acts for the person signed in, so a body naming anyone else is
 * refused rather than quietly swapped for the session user. */
async function trackerUser(req, res) {
    const actor = await actingUser(req);
    if (!actor) return refuse(res, 401, 'A signed-in user is required.');
    const claimed = [].concat((req.body && req.body.userId) || []).map(String).filter(Boolean);
    if (claimed.some((id) => id !== actor.id)) return refuse(res, 403, 'You can only track your own time.');
    return actor;
}

module.exports = { trackerUser, refuse };
