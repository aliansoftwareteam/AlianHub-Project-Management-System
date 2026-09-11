export const REPLAY_SECTION_ID = "replay";

const CALL_PREFIX = `${REPLAY_SECTION_ID}-`;

export const replayAnchorId = (recordId) => `${CALL_PREFIX}${recordId}`;

export const replayAnchor = (recordId) => `#${replayAnchorId(recordId)}`;

export const replayIdFromHash = (hash) => {
    const value = String(hash || "").replace(/^#/, "");
    return value.startsWith(CALL_PREFIX) ? decodeURIComponent(value.slice(CALL_PREFIX.length)) : "";
};
