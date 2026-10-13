export const CONNECT_AI_ROUTE = "AiConnect";
export const CONNECT_AI_WELCOME_ROUTE = "ConnectAiWelcome";
export const CONNECT_AI_WELCOME_PATH = "/:cid/welcome/connect-ai";

/* Where sign-up ends. A path, because the install wizard and the invitation leave by address, not by route name. */
export const connectAiWelcomePath = (companyId) => CONNECT_AI_WELCOME_PATH.replace(":cid", companyId || "");

export const BLUEPRINT_WELCOME_ROUTE = "BlueprintWelcome";
export const BLUEPRINT_WELCOME_PATH = "/:cid/welcome/blueprint";
