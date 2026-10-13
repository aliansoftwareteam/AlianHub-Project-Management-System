// CommonJS, so the repository's jest run can load it without the Next.js toolchain.

const TIMER_NOT_RUNNING = 'timer_not_running';

/* Only the server saying this timer is no longer running ends the session here. A lost connection,
 * a server fault or any other refusal leaves it running, because stopping loses tracked time. */
const timerStoppedElsewhere = (error) => {
  const response = error && error.response;
  return Boolean(response) && response.status === 403 && Boolean(response.data) && response.data.code === TIMER_NOT_RUNNING;
};

module.exports = { TIMER_NOT_RUNNING, timerStoppedElsewhere };
