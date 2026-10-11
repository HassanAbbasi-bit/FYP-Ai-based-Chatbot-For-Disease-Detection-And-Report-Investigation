import { api } from "./client.js";
export const reportsApi = {
  list: (cursor, signal) => api(`/reports${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }),
  detail: (id, signal) => api(`/reports/${id}`, { signal }),
  remove: (id, signal) => api(`/reports/${id}`, { method: "DELETE", signal }),
  upload: (file, uploadId, signal) => {
    const formData = new FormData(); formData.append("file", file);
    return api("/reports", { method: "POST", formData, headers: { "x-upload-id": uploadId }, signal });
  },
};
export const formatSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
