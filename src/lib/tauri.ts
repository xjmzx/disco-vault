import { invoke } from "@tauri-apps/api/core";

export interface Release {
  id?: number;
  artist: string;
  title: string;
  year?: number | null;
  medium?: "physical" | "digital" | null;
  format?: string | null;
  label?: string | null;
  catalogNumber?: string | null;
  country?: string | null;
  condition?: string | null;
  notes?: string | null;
  source?: string | null;
  filePath?: string | null;
  coverArtPath?: string | null;
  discogsId?: number | null;
  musicbrainzId?: string | null;
  addedAt?: number | null;
  updatedAt?: number | null;
}

export interface Stats {
  total: number;
  physical: number;
  digital: number;
  uniqueArtists: number;
  yearMin: number | null;
  yearMax: number | null;
}

export async function initDb(): Promise<string> {
  return invoke<string>("init_db");
}

export async function addRelease(release: Release): Promise<number> {
  return invoke<number>("add_release", { release });
}

export async function listReleases(
  query?: string,
  medium?: "physical" | "digital",
): Promise<Release[]> {
  return invoke<Release[]>("list_releases", { query, medium });
}

export async function deleteRelease(id: number): Promise<void> {
  return invoke("delete_release", { id });
}

export async function getStats(): Promise<Stats> {
  return invoke<Stats>("get_stats");
}
