export const PERIOD_LOCKED = 'period_locked';

export const timeLogFailureKey = (error, fallbackKey) => (error && error.code === PERIOD_LOCKED ? 'Time.period_locked' : fallbackKey);
