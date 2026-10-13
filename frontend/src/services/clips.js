// The server takes the clip owner from the session, so no user id is sent.
import { apiRequest } from "@/services";

// payload: { title, url, mediaType, mimeType, size, durationSec, source }
export const createClip = (payload) => apiRequest("post", "/api/v1/clips", payload);

export const listClips = () => apiRequest("get", "/api/v1/clips");

export const renameClip = (id, title) => apiRequest("patch", `/api/v1/clips/${id}`, { title });

export const deleteClip = (id) => apiRequest("delete", `/api/v1/clips/${id}`);
