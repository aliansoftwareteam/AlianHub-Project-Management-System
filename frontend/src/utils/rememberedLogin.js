const REMEMBER_KEY = "remember";

const parseRemembered = () => {
    try {
        return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null");
    } catch {
        return null;
    }
};

export const readRememberedEmail = () => {
    try {
        const saved = parseRemembered();
        const email = saved && typeof saved.email === "string" ? saved.email : "";
        // Entries written by older versions also held the password; rewrite them as email-only.
        if (email) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email }));
        else localStorage.removeItem(REMEMBER_KEY);
        return email;
    } catch {
        return "";
    }
};

export const saveRememberedEmail = (email) => localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email }));

export const forgetRememberedEmail = () => localStorage.removeItem(REMEMBER_KEY);
