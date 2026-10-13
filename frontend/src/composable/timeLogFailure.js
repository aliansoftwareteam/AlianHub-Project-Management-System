export const PERIOD_LOCKED = 'period_locked';

/* A failure marked `timerKept` left its timer as it was, so its message says the time is not lost. */
export const timeLogFailureKey = (failure, fallbackKey) => {
    const locked = Boolean(failure) && failure.code === PERIOD_LOCKED;
    if (failure && failure.timerKept) return locked ? 'Time.timer_kept_period_locked' : 'Time.timer_kept_log_failed';
    return locked ? 'Time.period_locked' : fallbackKey;
};
