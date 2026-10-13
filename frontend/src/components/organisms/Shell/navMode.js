/* Simple only hides ways in. Nothing that decides what a person may open reads the mode: every
   page still opens by its address, from the palette and from More. */
export const NAV_MODES = ["simple", "full"];
export const DEFAULT_NAV_MODE = "full";
export const SIMPLE_PLACES = ["home", "everything", "projects", "inbox", "ai", "appConnections"];
export const PHONE_TABS = {
    full: ["home", "inbox", "chat", "ai"],
    simple: ["home", "everything", "inbox", "ai"]
};

export const isNavMode = (value) => NAV_MODES.includes(value);
/* An account made before the choice existed stores none, and stays on the rail it had. */
export const navModeOf = (value) => (isNavMode(value) ? value : DEFAULT_NAV_MODE);
