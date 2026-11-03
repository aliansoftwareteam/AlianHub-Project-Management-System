const KEY = "ah.platformSignIn";

/* Set by the page the portal's sign-in link opens, read once by the shell after landing. */
export const notePlatformSignIn = () => {
    try {
        sessionStorage.setItem(KEY, "1");
    } catch {
        // Private windows may refuse storage; the notice is then simply not shown.
    }
};

export const takePlatformSignIn = () => {
    try {
        const noted = sessionStorage.getItem(KEY) === "1";
        sessionStorage.removeItem(KEY);
        return noted;
    } catch {
        return false;
    }
};
