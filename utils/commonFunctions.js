const {myCache} = require('../Config/config');
/* ------------- GENERATE UNIQUE ID  ------------- */
exports.makeUniqueId = (length) =>  {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * 
        charactersLength));
    }
    return result;
}


exports.removeCache = (cacheKey,isKeyWithPrefix) => {
    if (isKeyWithPrefix) {
        let mykeys = myCache.keys();
        let projectDt = mykeys.filter((x)=> x.includes(cacheKey));
        myCache.del([...projectDt]);
    } else {
        myCache.del(cacheKey);
    }
}

/* ------------- STATIC ALIANHUB AI BOT USER -------------
 * Global, in-code stand-in user for automated actions taken by the system
 * (proposal-review auto-moves, future bot features). NOT persisted in the
 * `users` collection — purely an attribution object that consumers can read
 * via `userData.id` / `userData.Employee_Name` to label activity history,
 * notifications, and comments as authored by "AlianHub AI Bot".
 *
 * The `_id` is a fictional 24-char hex string that intentionally does NOT
 * collide with any real user ObjectId. Anywhere downstream that tries to
 * resolve this id against the real `users` collection will simply not find
 * it — which is fine: the Employee_Name is what shows in history messages.
 *
 * Frozen so callers can't accidentally mutate the shared instance.
 */
exports.ALIANHUB_BOT_USER = Object.freeze({
    id: '000000000000000000000b07',          // 21x'0' + 'b07' (~= "bot") — clearly a placeholder
    _id: '000000000000000000000b07',
    Employee_Name: 'AlianHub AI Bot',
    Employee_FName: 'AlianHub',
    Employee_LName: 'Bot',
    Employee_Email: 'bot@alianhub.local',
    companyOwnerId: '',
    isActive: true,
    isOnline: false,
    isEmailVerified: true,
});