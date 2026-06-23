// Clips API service.
//
// Mirrors the small per-feature call style used by Notepad/Stickies: thin
// named-export wrappers over the shared `apiRequest` helper (which attaches the
// auth token + companyId header via its request interceptor). The clips
// endpoints live under /api/v1 (not v2).
//
// NOTE on userId: the backend has no global auth middleware that sets req.user,
// so — exactly like the Notes/Reminders modules — the client must send the acting
// user id. We read it from localStorage (the same source services/index.js uses)
// and pass it in the body for writes; the GET has no body, so it goes as a query
// param (the controller's resolveUserId reads req.query.userId).
import { apiRequest } from "@/services";

const getUserId = () => localStorage.getItem("userId") || "";

// Create a clip record after the blob has already been uploaded to storage.
// payload: { title, url, mediaType, mimeType, size, durationSec, source }
export const createClip = (payload) =>
    apiRequest("post", "/api/v1/clips", { ...payload, userId: getUserId(), userData: { id: getUserId() } });

// List the caller's own clips, newest first.
export const listClips = () =>
    apiRequest("get", `/api/v1/clips?userId=${encodeURIComponent(getUserId())}`);

// Rename a clip (scoped by _id + company server-side).
export const renameClip = (id, title) => apiRequest("patch", `/api/v1/clips/${id}`, { title });

// Soft-delete a clip.
export const deleteClip = (id) => apiRequest("delete", `/api/v1/clips/${id}`);
