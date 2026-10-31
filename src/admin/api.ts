// Client for the admin page's API (server/admin-api.js). The session token
// lives in sessionStorage, so closing the tab logs out.

import type { VesselInfo, VesselPhoto } from "../types/vessel";

const TOKEN_KEY = "bridgeview-admin-token";

// Fields that can be set by hand (OVERRIDE_FIELDS in server/vessel-overrides.js)
export const OVERRIDE_FIELDS = [
  { key: "name", label: "Name", type: "text" },
  { key: "description", label: "Description", type: "text" },
  { key: "builder", label: "Builder", type: "text" },
  { key: "operator", label: "Operator", type: "text" },
  { key: "yearBuilt", label: "Year built", type: "number" },
  { key: "grossTonnage", label: "Gross tonnage", type: "number" },
  { key: "wikipediaUrl", label: "Wikipedia URL", type: "url" },
] as const;

export type OverrideField = (typeof OVERRIDE_FIELDS)[number]["key"];

export interface VesselOverrides {
  fields?: Partial<Record<OverrideField, string | number>>;
  addedPhotos?: VesselPhoto[];
  hiddenPhotos?: string[];
  primaryPhoto?: string;
}

export interface AdminShipSummary {
  mmsi: number;
  name?: string;
  imo?: number;
  callSign?: string;
  shipType?: number;
  length?: number;
  updatedAt: string;
  found: boolean;
  overridden: boolean;
  /** Photos the ship's card shows, after corrections */
  photoCount: number;
}

export interface AdminShipRecord {
  name?: string;
  callSign?: string;
  imo?: number;
  shipType?: number;
  destination?: string;
  length?: number;
  width?: number;
  draught?: number;
}

export interface AdminShipView {
  mmsi: number;
  record: AdminShipRecord;
  /** What the lookups and registers found, before corrections */
  lookedUp: VesselInfo | null;
  lookedUpAt: string | null;
  overrides: VesselOverrides;
  /** What clients get */
  info: VesselInfo | null;
}

/** The session has ended (or never started): show the login form */
export class AuthError extends Error {}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage might not be available
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  });
  if (res.status === 401) {
    setToken(null);
    const body = await res.json().catch(() => null);
    throw new AuthError(body?.error ?? "Log in first");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export async function login(password: string): Promise<void> {
  const { token } = await request<{ token: string }>("/api/admin/login", json("POST", { password }));
  setToken(token);
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/api/admin/logout", { method: "POST" });
  } finally {
    setToken(null);
  }
}

export function checkSession(): Promise<{ expiresAt: string }> {
  return request("/api/admin/session");
}

/** The admin search's ship type filter (server/vessel-details.js, SHIP_TYPE_FILTERS) */
export const SHIP_TYPE_FILTERS = [
  { value: "cargo", label: "Cargo" },
  { value: "tanker", label: "Tanker" },
  { value: "passenger", label: "Passenger" },
  { value: "tug", label: "Tug" },
  { value: "pleasure", label: "Pleasure craft & sailing" },
  { value: "fishing", label: "Fishing" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Type not known" },
] as const;

export type ShipTypeFilter = (typeof SHIP_TYPE_FILTERS)[number]["value"];

export interface ShipSearchOptions {
  query: string;
  overriddenOnly: boolean;
  type: ShipTypeFilter | "";
  offset?: number;
}

export interface ShipSearchResult {
  ships: AdminShipSummary[];
  /** How many ships match in all; the server sends 50 at a time */
  total: number;
}

export function searchShips({ query, overriddenOnly, type, offset = 0 }: ShipSearchOptions): Promise<ShipSearchResult> {
  const params = new URLSearchParams({ q: query });
  if (overriddenOnly) params.set("overridden", "1");
  if (type) params.set("type", type);
  if (offset) params.set("offset", String(offset));
  return request<ShipSearchResult>(`/api/admin/ships?${params}`);
}

export function getShip(mmsi: number): Promise<AdminShipView> {
  return request(`/api/admin/ships/${mmsi}`);
}

export function saveOverrides(mmsi: number, overrides: VesselOverrides): Promise<AdminShipView> {
  return request(`/api/admin/ships/${mmsi}/overrides`, json("PUT", overrides));
}

export function refreshShip(mmsi: number): Promise<void> {
  return request(`/api/admin/ships/${mmsi}/refresh`, { method: "POST" });
}

export function uploadPhoto(
  mmsi: number,
  file: File,
  credit: { title?: string; artist?: string; license?: string }
): Promise<AdminShipView> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(credit)) if (value) params.set(key, value);
  return request(`/api/admin/ships/${mmsi}/photos?${params}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
}

/** Photos on Wikimedia Commons matching `query`, best match first, with their credits */
export async function searchPhotos(query: string): Promise<VesselPhoto[]> {
  const { photos } = await request<{ photos: VesselPhoto[] }>(`/api/admin/photos/search?${new URLSearchParams({ q: query })}`);
  return photos;
}

/** A photo shared from the iOS app, waiting for approval */
export interface PhotoSubmission {
  id: number;
  mmsi: number;
  shipName?: string;
  url: string;
  /** The name the sharer asked to be credited as */
  artist?: string;
  note?: string;
  /** Size in pixels */
  width?: number;
  height?: number;
  createdAt: string;
}

/** A sender banned from sharing photos */
export interface PhotoBan {
  id: number;
  reason?: string;
  /** Whether the app's device ID is banned too, not just the IP address */
  device: boolean;
  createdAt: string;
}

export async function getSubmissions(): Promise<PhotoSubmission[]> {
  const { submissions } = await request<{ submissions: PhotoSubmission[] }>("/api/admin/submissions");
  return submissions;
}

/** Adds the photo to its ship, first */
export function approveSubmission(id: number): Promise<AdminShipView> {
  return request(`/api/admin/submissions/${id}/approve`, { method: "POST" });
}

/** Deletes the photo */
export function rejectSubmission(id: number): Promise<void> {
  return request(`/api/admin/submissions/${id}`, { method: "DELETE" });
}

/** Bans whoever sent the photo, deleting it and everything else they've sent */
export function banSubmitter(id: number, reason: string): Promise<{ rejected: number[] }> {
  return request(`/api/admin/submissions/${id}/ban`, json("POST", { reason }));
}

export async function getBans(): Promise<PhotoBan[]> {
  const { bans } = await request<{ bans: PhotoBan[] }>("/api/admin/submissions/bans");
  return bans;
}

export function liftBan(id: number): Promise<void> {
  return request(`/api/admin/submissions/bans/${id}`, { method: "DELETE" });
}

/** Why a photo was reported from the app (REPORT_REASONS in server/photo-reports.js) */
export const REPORT_REASONS: Record<string, string> = {
  "wrong-ship": "Not this ship",
  offensive: "Offensive",
  privacy: "Privacy",
  copyright: "Copyright",
  other: "Other",
};

/** A photo reported from the app, with its reports */
export interface ReportedPhoto {
  url: string;
  mmsi: number;
  shipName?: string;
  reports: { reason: string; details?: string; createdAt: string }[];
}

export async function getReportedPhotos(): Promise<ReportedPhoto[]> {
  const { photos } = await request<{ photos: ReportedPhoto[] }>("/api/admin/reports");
  return photos;
}

/** Hides the photo on its ship (removes it if it was added by hand), closing its reports */
export function hideReportedPhoto(url: string): Promise<AdminShipView> {
  return request("/api/admin/reports/hide", json("POST", { url }));
}

/** Closes the photo's reports, leaving it shown */
export function dismissReports(url: string): Promise<void> {
  return request("/api/admin/reports/dismiss", json("POST", { url }));
}
