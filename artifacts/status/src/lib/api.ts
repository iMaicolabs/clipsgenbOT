const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export interface User {
  id: number;
  email: string;
  username: string;
  createdAt?: string;
}

export interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  isLive: boolean;
  wasLive: boolean;
}

export interface ClipJob {
  id: string;
  status: "pending" | "processing" | "done" | "error";
  progress: number;
  progressMsg: string;
  filePath?: string;
  sizeBytes?: number;
  error?: string;
}

export interface SavedClip {
  id: number;
  userId: number;
  youtubeUrl: string;
  videoTitle: string | null;
  videoThumbnail: string | null;
  startStr: string;
  endStr: string;
  quality: string;
  status: string;
  sizeBytes: number | null;
  fileAvailable: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export function createJobEventSource(jobId: string): EventSource {
  return new EventSource(`${BASE}/api/web-clips/job/${jobId}/events`, {
    withCredentials: true,
  } as EventSourceInit);
}

export function getVideoInfo(url: string, signal?: AbortSignal) {
  return api.get<VideoInfo>(`/video/info?url=${encodeURIComponent(url)}`, signal);
}

export function createClip(params: {
  url: string;
  startSec: number;
  endSec: number;
  startStr: string;
  endStr: string;
  quality: string;
  save: boolean;
  videoTitle?: string;
  videoThumbnail?: string;
}) {
  return api.post<{ jobId: string; dbClipId?: number }>("/web-clips", params);
}

export function getMyClips() {
  return api.get<SavedClip[]>("/web-clips");
}

export function deleteClip(id: number) {
  return api.del<{ ok: boolean }>(`/web-clips/${id}`);
}

export function getMe() {
  return api.get<User>("/auth/me");
}

export function login(email: string, password: string) {
  return api.post<User>("/auth/login", { email, password });
}

export function register(email: string, username: string, password: string) {
  return api.post<User>("/auth/register", { email, username, password });
}

export function logout() {
  return api.post<{ ok: boolean }>("/auth/logout", {});
}

export function downloadUrl(jobId: string) {
  return `${BASE}/api/web-clips/job/${jobId}/download`;
}

export function downloadDbUrl(dbClipId: number) {
  return `${BASE}/api/web-clips/db/${dbClipId}/download`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseTime(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN)) throw new Error(`Tiempo inválido: "${t}"`);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}
