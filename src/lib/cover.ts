import { convertFileSrc } from "@tauri-apps/api/core";
import type { Release } from "./tauri";

// Prefer the published URL (works in the app and on the website); fall back to
// a local cover.jpg path picked up by the folder import (works only in the
// app, served via Tauri's asset:// protocol).
export function coverImageSrc(r: Release): string | null {
  const url = r.coverArtUrl?.trim();
  if (url) return url;
  const local = r.coverArtPath?.trim();
  if (local) return convertFileSrc(local);
  return null;
}
