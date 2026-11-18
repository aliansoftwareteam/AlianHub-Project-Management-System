const TAB_ID = /^tab-[0-9a-f]{32}$/;

function tabMarkerOf(value) {
    if (!value || typeof value !== 'object' || typeof value.user !== 'string' || !TAB_ID.test(value.user)) return null;
    return Number.isFinite(value.timeStamp) ? { user: value.user, timeStamp: value.timeStamp } : { user: value.user };
}

/* The web app marks its own drag updates with a per-tab id; anything else sent as that
 * marker, such as a value from an older client, is dropped rather than stored. */
function keepTabMarkerOnly(updateData) {
    if (!updateData || typeof updateData !== 'object' || !Object.prototype.hasOwnProperty.call(updateData, 'updateToken')) return updateData;
    const { updateToken, ...rest } = updateData;
    const marker = tabMarkerOf(updateToken);
    return marker ? { ...rest, updateToken: marker } : rest;
}

module.exports = { TAB_ID, keepTabMarkerOnly };
