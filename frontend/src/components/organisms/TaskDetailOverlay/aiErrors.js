const MESSAGE_KEYS = Object.freeze({
    ai_off: "TaskAi.ai_off",
    unconfigured: "TaskAi.unconfigured",
    task_not_found: "TaskAi.not_found",
});

/* The server's refusal code as a sentence; anything unrecognised reads as a plain failure. */
export function aiErrorKey(payload, fallback = "TaskAi.failed") {
    const code = payload?.code;
    return Object.hasOwn(MESSAGE_KEYS, code) ? MESSAGE_KEYS[code] : fallback;
}

export function payloadOf(error) {
    return error?.response?.data || {};
}
