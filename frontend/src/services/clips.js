// Clips API service.
//
// Mirrors the small per-feature call style used by Notepad/Stickies: thin
// named-export wrappers over the shared `apiRequest` helper (which attaches the
// auth token + companyId header via its request interceptor). The clips
// endpoints live under /api/v1 (not v2).
import { apiRequest } from "@/services";

// Create a clip record after the blob has already been uploaded to storage.
// payload: { title, url, mediaType, mimeType, size, durationSec, source }
export const createClip = (payload) => apiRequest("post", "/api/v1/clips", payload);

// List the caller's own clips, newest first.
export const listClips = () => apiRequest("get", "/api/v1/clips");

// Rename a clip.
export const renameClip = (id, title) => apiRequest("patch", `/api/v1/clips/${id}`, { title });

// Soft-delete a clip.
export const deleteClip = (id) => apiRequest("delete", `/api/v1/clips/${id}`);
