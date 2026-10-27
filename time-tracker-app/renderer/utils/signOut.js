// CommonJS, so the repository's jest run can load it without the Next.js toolchain.

/* The server's answer is about the sign-in, not the request: the same request can be sent again
 * once the person signs in, so it is never a reason to drop queued time. */
const signInRefused = (error) => {
  const data = error && error.response && error.response.data;
  return Boolean(data) && Boolean(data.isJwtError || data.isLogout);
};

/* A session that can no longer be refreshed is also refused by the server's sign-out, so the local
 * session ends whatever the server answers. Requests refused while signing out ask to sign out
 * again; they join the sign-out already running, which is what stops the logout and refresh loop. */
const createSignOut = ({ replayQueue, endServerSession, endLocalSession, holdForQueue }) => {
  let running = null;

  const signOut = async () => {
    const { remaining } = await replayQueue();
    if (remaining > 0) {
      holdForQueue();
      return;
    }
    try {
      await endServerSession();
    } catch (error) {
      console.error('The server did not end the session:', error);
    }
    endLocalSession();
  };

  return () => {
    if (!running) {
      // Started on the next tick, so a call made while it starts already finds it running.
      running = Promise.resolve()
        .then(signOut)
        .catch((error) => console.error(error))
        .finally(() => { running = null; });
    }
    return running;
  };
};

module.exports = { signInRefused, createSignOut };
