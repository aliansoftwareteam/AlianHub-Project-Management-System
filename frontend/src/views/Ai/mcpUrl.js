import * as env from "@/config/env";

// One source for the MCP endpoint a CLI agent connects to. The server keys the
// tenant off ?companyId= (Modules/Mcp/server.js), so the parameter is not optional.
export const mcpUrlFor = (companyId) => `${env.API_URI}/mcp?companyId=${encodeURIComponent(companyId || "")}`;

export const mcpAddCommand = (companyId, token = "<your token>") => `claude mcp add --transport http alianhub "${mcpUrlFor(companyId)}" --header "Authorization: Bearer ${token}"`;
