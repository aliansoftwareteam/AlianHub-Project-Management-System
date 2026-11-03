/* Pure answers to "may this happen?". A null or undefined limit is unlimited. Each returns
 * { ok: true } or { ok: false, code, limit, used }. */

const CODES = Object.freeze({
    SEAT_LIMIT: 'seat_limit',
    STORAGE_FULL: 'storage_full',
    FILE_TOO_LARGE: 'file_too_large',
    WORKSPACE_LIMIT: 'workspace_limit',
    TRACKER_DISABLED: 'tracker_disabled',
    TRACKER_SEAT_LIMIT: 'tracker_seat_limit',
    MAIL_CAP: 'mail_cap',
});

const OK = Object.freeze({ ok: true });

const unlimited = (limit) => limit === null || limit === undefined || limit === '' || !Number.isFinite(Number(limit));
const amount = (value) => Math.max(0, Number(value) || 0);
const refuse = (code, limit, used) => ({ ok: false, code, limit: Number(limit), used: amount(used) });

function canAddSeats({ activeSeats, adding = 1, limit }) {
    if (unlimited(limit) || amount(adding) === 0) return OK;
    return amount(activeSeats) + amount(adding) <= Number(limit) ? OK : refuse(CODES.SEAT_LIMIT, limit, activeSeats);
}

/* Adding nothing still asks whether the quota is already spent, so a full instance refuses an
 * upload before its size is known. */
function canStore({ usedBytes, adding = 0, limit }) {
    if (unlimited(limit)) return OK;
    const used = amount(usedBytes);
    const extra = amount(adding);
    const fits = extra === 0 ? used < Number(limit) : used + extra <= Number(limit);
    return fits ? OK : refuse(CODES.STORAGE_FULL, limit, used);
}

function fileAllowed({ size, maxFileBytes }) {
    if (unlimited(maxFileBytes)) return OK;
    return amount(size) <= Number(maxFileBytes) ? OK : refuse(CODES.FILE_TOO_LARGE, maxFileBytes, size);
}

function canCreateWorkspace({ count, limit }) {
    if (unlimited(limit)) return OK;
    return amount(count) + 1 <= Number(limit) ? OK : refuse(CODES.WORKSPACE_LIMIT, limit, count);
}

function canAssignTrackerSeat({ used, limit, enabled = true }) {
    if (enabled === false) return refuse(CODES.TRACKER_DISABLED, 0, used);
    if (unlimited(limit)) return OK;
    return amount(used) + 1 <= Number(limit) ? OK : refuse(CODES.TRACKER_SEAT_LIMIT, limit, used);
}

function canSendMail({ sentToday, limit }) {
    if (unlimited(limit)) return OK;
    return amount(sentToday) < Number(limit) ? OK : refuse(CODES.MAIL_CAP, limit, sentToday);
}

/* 0 below 80%, then 80, 95 and 100: what the banner and the portal notice key on. */
function storageLevel({ usedBytes, limit }) {
    if (unlimited(limit) || Number(limit) <= 0) return 0;
    const share = amount(usedBytes) / Number(limit);
    if (share >= 1) return 100;
    if (share >= 0.95) return 95;
    if (share >= 0.8) return 80;
    return 0;
}

module.exports = {
    CODES, OK, unlimited, canAddSeats, canStore, fileAllowed, canCreateWorkspace, canAssignTrackerSeat, canSendMail, storageLevel,
};
