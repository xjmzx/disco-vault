import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Disc3,
  FolderSearch,
  ImageOff,
  RefreshCw,
  ScanLine,
  Search,
  Wand2,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import {
  deleteRelease,
  extractEmbeddedCovers,
  listReleases,
  rescanLocalCovers,
  scanLibraryChanges,
  setCoverArtUrl,
  updateReleasePath,
  type ExtractSummary,
  type ImportProgress,
  type LibraryScanSummary,
  type OrphanInfo,
  type PublishedFilter,
  type Release,
  type RescanSummary,
} from "../lib/tauri";
import { coverImageSrc } from "../lib/cover";
import { cn } from "../lib/cn";

export interface FilterContext {
  query: string;
  medium: "physical" | "digital" | null;
  needsCoverOnly: boolean;
  publishedFilter: PublishedFilter | null;
  count: number;
}

interface Props {
  reloadKey: number;
  onSelect: (r: Release) => void;
  selected: Release | null;
  onFilterChange?: (ctx: FilterContext) => void;
}

type MediumFilter = "" | "physical" | "digital";

export function ReleaseList({
  reloadKey,
  onSelect,
  selected,
  onFilterChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [medium, setMedium] = useState<MediumFilter>("");
  const [needsCoverOnly, setNeedsCoverOnly] = useState(false);
  const [publishedFilter, setPublishedFilter] =
    useState<"" | PublishedFilter>("");
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline cover-paste state (only used when needsCoverOnly is true).
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());
  const [savingId, setSavingId] = useState<number | null>(null);
  const [autoFocusPending, setAutoFocusPending] = useState(false);
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Cover-cleanup background ops. Extract reads embedded artwork from audio
  // file tags; rescan walks album directories for a wider set of cover
  // filename patterns.
  type OpKind = "extract" | "rescan" | "scan";
  const [activeOp, setActiveOp] = useState<OpKind | null>(null);
  const [opProgress, setOpProgress] = useState<ImportProgress | null>(null);
  const [opSummary, setOpSummary] = useState<
    | { kind: "extract"; data: ExtractSummary }
    | { kind: "rescan"; data: RescanSummary }
    | { kind: "scan"; data: LibraryScanSummary }
    | null
  >(null);

  function setDraft(id: number, value: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }

  async function runBackgroundOp(kind: OpKind) {
    if (activeOp !== null) return;
    const config =
      kind === "extract"
        ? {
            prompt:
              "Scan digital releases without a cover and extract embedded " +
                "artwork from their audio file tags?\n\n" +
                "For each release with embedded artwork, a file named " +
                "cover-extracted.{jpg,png,…} will be written into the album " +
                "directory and used as the local cover.",
            startEvent: "extract:started",
            progressEvent: "extract:progress",
          }
        : kind === "rescan"
          ? {
              prompt:
                "Re-scan album directories for cover-art image files using " +
                  "broader filename matching (albumart.*, art.*, files named " +
                  "after the album, etc.)?\n\n" +
                  "Only releases that still have no cover will be touched — " +
                  "no existing data is overwritten.",
              startEvent: "rescan:started",
              progressEvent: "rescan:progress",
            }
          : {
              prompt:
                "Scan the whole library for filesystem changes?\n\n" +
                  "For each release with a file path, re-reads audio tags " +
                  "and looks up the local cover, updating the DB to match " +
                  "what's on disk. Reports refreshed / unchanged / " +
                  "orphaned (path missing) counts at the end.\n\n" +
                  "Useful after editing files in another music app.",
              startEvent: "scan:started",
              progressEvent: "scan:progress",
            };

    const dialogTitle =
      kind === "extract"
        ? "Extract embedded artwork"
        : kind === "rescan"
          ? "Rescan local covers"
          : "Scan library for changes";
    const yes = await ask(config.prompt, {
      title: dialogTitle,
      kind: "info",
    });
    if (!yes) return;

    setActiveOp(kind);
    setOpSummary(null);
    setOpProgress({ current: 0, total: 0, currentDir: "" });
    setError(null);

    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<number>(config.startEvent, (e) => {
          setOpProgress((p) => ({
            current: p?.current ?? 0,
            total: e.payload,
            currentDir: p?.currentDir ?? "",
          }));
        }),
      );
      unlisteners.push(
        await listen<ImportProgress>(config.progressEvent, (e) => {
          setOpProgress(e.payload);
        }),
      );

      if (kind === "extract") {
        const data = await extractEmbeddedCovers();
        setOpSummary({ kind: "extract", data });
      } else if (kind === "rescan") {
        const data = await rescanLocalCovers();
        setOpSummary({ kind: "rescan", data });
      } else {
        const data = await scanLibraryChanges();
        setOpSummary({ kind: "scan", data });
      }
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      unlisteners.forEach((f) => f());
      setActiveOp(null);
    }
  }

  async function deleteOrphan(e: React.MouseEvent, orphan: OrphanInfo) {
    e.preventDefault();
    e.stopPropagation();
    const yes = await ask(
      `Delete the database row for "${orphan.artist} — ${orphan.title}"?\n\n` +
        `Old path: ${orphan.filePath}\n\n` +
        `The release is already missing from disk; this removes the orphaned ` +
        `DB row. Any previously-published Nostr event remains until you ` +
        `Unpublish it.`,
      { title: "Delete orphan", kind: "warning" },
    );
    if (!yes) return;
    try {
      await deleteRelease(orphan.id);
      setOpSummary((prev) => {
        if (!prev || prev.kind !== "scan") return prev;
        return {
          kind: "scan",
          data: {
            ...prev.data,
            scanned: Math.max(0, prev.data.scanned - 1),
            orphaned: Math.max(0, prev.data.orphaned - 1),
            orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
          },
        };
      });
      await reload();
    } catch (err) {
      setError(String(err));
    }
  }

  async function relocateOrphan(
    e: React.MouseEvent,
    orphan: OrphanInfo,
  ) {
    e.preventDefault();
    e.stopPropagation();
    let picked: string | null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: `New location for ${orphan.artist} — ${orphan.title}`,
      });
      picked = typeof result === "string" ? result : null;
    } catch (err) {
      setError(String(err));
      return;
    }
    if (!picked) return;

    try {
      await updateReleasePath(orphan.id, picked);
      setOpSummary((prev) => {
        if (!prev || prev.kind !== "scan") return prev;
        return {
          kind: "scan",
          data: {
            ...prev.data,
            orphaned: Math.max(0, prev.data.orphaned - 1),
            refreshed: prev.data.refreshed + 1,
            orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
          },
        };
      });
      await reload();
    } catch (err) {
      setError(String(err));
    }
  }

  async function saveCover(releaseId: number) {
    const url = drafts.get(releaseId)?.trim();
    if (!url || savingId !== null) return;
    setSavingId(releaseId);
    setError(null);
    try {
      await setCoverArtUrl(releaseId, url);
      const savedIdx = items.findIndex((r) => r.id === releaseId);
      const nextId =
        savedIdx >= 0 && savedIdx + 1 < items.length
          ? items[savedIdx + 1].id
          : undefined;
      setItems((prev) => prev.filter((r) => r.id !== releaseId));
      setDrafts((prev) => {
        const next = new Map(prev);
        next.delete(releaseId);
        return next;
      });
      if (nextId !== undefined) {
        requestAnimationFrame(() => {
          inputRefs.current.get(nextId)?.focus();
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const list = await listReleases(
        query,
        medium || undefined,
        needsCoverOnly ? true : undefined,
        publishedFilter || undefined,
      );
      setItems(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, medium, needsCoverOnly, publishedFilter]);

  // Bubble filter state + visible-items count up so other panels (like the
  // Nostr Sync publish-library button) can render contextual UI.
  useEffect(() => {
    if (!onFilterChange) return;
    onFilterChange({
      query,
      medium: medium === "" ? null : medium,
      needsCoverOnly,
      publishedFilter: publishedFilter === "" ? null : publishedFilter,
      count: items.length,
    });
  }, [
    query,
    medium,
    needsCoverOnly,
    publishedFilter,
    items.length,
    onFilterChange,
  ]);

  // When the no-cover filter is turned on, autofocus the first row's URL
  // input once the list has loaded.
  useEffect(() => {
    if (needsCoverOnly) {
      setAutoFocusPending(true);
    } else {
      setDrafts(new Map());
      inputRefs.current.clear();
    }
  }, [needsCoverOnly]);

  useEffect(() => {
    if (!autoFocusPending || items.length === 0) return;
    const firstId = items[0].id;
    if (firstId !== undefined) {
      requestAnimationFrame(() => {
        inputRefs.current.get(firstId)?.focus();
      });
    }
    setAutoFocusPending(false);
  }, [items, autoFocusPending]);

  const publishedCount = items.filter(
    (r) => r.lastPublishedAt != null,
  ).length;
  const unpublishedCount = items.length - publishedCount;

  return (
    <Section
      title="Releases"
      icon={<Disc3 size={16} />}
      right={
        <span className="text-xs text-muted">
          {items.length} {items.length === 1 ? "release" : "releases"}
          {items.length > 0 && (
            <>
              <span className="ml-1">· {publishedCount} published</span>
              <span className="ml-1">· {unpublishedCount} unpublished</span>
            </>
          )}
          {needsCoverOnly && (
            <span className="ml-1 text-warn">· no cover</span>
          )}
        </span>
      }
      className="h-full"
    >
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reload()}
            placeholder="search artist / title / label / catalog #"
            className="w-full pl-7 pr-3 py-2 rounded-md bg-surface text-fg
                       placeholder:text-muted outline-none border border-transparent
                       focus:border-accent/50 text-xs"
            spellCheck={false}
          />
        </div>
        <div className="relative">
          <select
            value={medium}
            onChange={(e) => setMedium(e.target.value as MediumFilter)}
            className="appearance-none pl-2.5 pr-7 py-2 rounded-md bg-accent text-bg
                       text-xs font-semibold outline-none border border-transparent
                       focus:border-fg/30 cursor-pointer"
          >
            <option value="">all</option>
            <option value="physical">physical</option>
            <option value="digital">digital</option>
          </select>
          <ChevronDown
            size={12}
            strokeWidth={2.5}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-bg
                       pointer-events-none"
          />
        </div>
        <div className="relative">
          <select
            value={publishedFilter}
            onChange={(e) =>
              setPublishedFilter(e.target.value as "" | PublishedFilter)
            }
            title="Filter by Nostr publish state"
            className="appearance-none pl-2.5 pr-7 py-2 rounded-md bg-surface
                       text-fg text-xs outline-none border border-transparent
                       focus:border-accent/50 cursor-pointer"
          >
            <option value="">any</option>
            <option value="published">published</option>
            <option value="unpublished">unpublished</option>
          </select>
          <ChevronDown
            size={12}
            strokeWidth={2.5}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted
                       pointer-events-none"
          />
        </div>
        <button
          onClick={() => setNeedsCoverOnly((v) => !v)}
          className={cn(
            "p-2 rounded-md text-fg",
            needsCoverOnly
              ? "bg-accent text-bg"
              : "bg-surface hover:bg-surfaceHover",
          )}
          title={
            needsCoverOnly
              ? "Showing only releases without a cover (click to clear)"
              : "Show only releases without a cover"
          }
          aria-pressed={needsCoverOnly}
        >
          <ImageOff size={14} />
        </button>
        <button
          onClick={() => runBackgroundOp("extract")}
          disabled={activeOp !== null}
          className="p-2 rounded-md bg-surface hover:bg-surfaceHover text-fg
                     disabled:opacity-50"
          title="Extract embedded artwork from audio files (digital releases without a cover)"
        >
          <Wand2
            size={14}
            className={
              activeOp === "extract" ? "animate-pulse text-accent" : ""
            }
          />
        </button>
        <button
          onClick={() => runBackgroundOp("rescan")}
          disabled={activeOp !== null}
          className="p-2 rounded-md bg-surface hover:bg-surfaceHover text-fg
                     disabled:opacity-50"
          title="Scan album directories for cover image files (broader filename matching)"
        >
          <FolderSearch
            size={14}
            className={
              activeOp === "rescan" ? "animate-pulse text-accent" : ""
            }
          />
        </button>
        <button
          onClick={() => runBackgroundOp("scan")}
          disabled={activeOp !== null}
          className="p-2 rounded-md bg-surface hover:bg-surfaceHover text-fg
                     disabled:opacity-50"
          title="Scan library for changes — re-read tags + cover for every release with a file path"
        >
          <ScanLine
            size={14}
            className={
              activeOp === "scan" ? "animate-pulse text-accent" : ""
            }
          />
        </button>
        <button
          onClick={reload}
          disabled={loading}
          className="p-2 rounded-md bg-surface hover:bg-surfaceHover text-fg
                     disabled:opacity-50"
          title="Reload"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-alert font-mono break-all">{error}</p>
      )}

      {activeOp && opProgress && (
        <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs">
          <div className="flex justify-between text-muted">
            <span>
              {activeOp === "extract"
                ? "extracting embedded artwork"
                : activeOp === "rescan"
                  ? "scanning for local cover files"
                  : "scanning library for changes"}{" "}
              <span className="font-mono text-fg">
                {opProgress.current.toLocaleString()}/
                {(opProgress.total || 0).toLocaleString()}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{
                width: `${
                  opProgress.total > 0
                    ? Math.min(
                        100,
                        (opProgress.current / opProgress.total) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="mt-1 text-[10px] font-mono text-fg/60 truncate">
            {opProgress.currentDir}
          </div>
        </div>
      )}

      {!activeOp && opSummary && (
        <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs
                        flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {opSummary.kind === "extract" && (
              <>
                <span className="text-ok">
                  extracted{" "}
                  <span className="font-mono">{opSummary.data.extracted}</span>
                </span>
                <span className="text-muted">
                  no embedded{" "}
                  <span className="font-mono">
                    {opSummary.data.noEmbedded}
                  </span>
                </span>
                {opSummary.data.noAudio > 0 && (
                  <span className="text-muted">
                    no audio{" "}
                    <span className="font-mono">{opSummary.data.noAudio}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind === "rescan" && (
              <>
                <span className="text-ok">
                  matched{" "}
                  <span className="font-mono">{opSummary.data.matched}</span>
                </span>
                <span className="text-muted">
                  no match{" "}
                  <span className="font-mono">{opSummary.data.noMatch}</span>
                </span>
                {opSummary.data.noDir > 0 && (
                  <span className="text-muted">
                    no dir{" "}
                    <span className="font-mono">{opSummary.data.noDir}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind === "scan" && (
              <>
                <span className="text-ok">
                  refreshed{" "}
                  <span className="font-mono">{opSummary.data.refreshed}</span>
                </span>
                <span className="text-muted">
                  unchanged{" "}
                  <span className="font-mono">{opSummary.data.noChanges}</span>
                </span>
                {opSummary.data.orphaned > 0 && (
                  <span className="text-warn">
                    orphaned{" "}
                    <span className="font-mono">{opSummary.data.orphaned}</span>
                  </span>
                )}
                {opSummary.data.noAudio > 0 && (
                  <span className="text-muted">
                    no audio{" "}
                    <span className="font-mono">{opSummary.data.noAudio}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.data.errors.length > 0 && (
              <span className="text-alert">
                errors{" "}
                <span className="font-mono">
                  {opSummary.data.errors.length}
                </span>
              </span>
            )}
          </div>
          <button
            onClick={() => setOpSummary(null)}
            className="text-muted hover:text-fg text-[10px] px-1"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {!activeOp && opSummary?.kind === "scan" && opSummary.data.orphans.length > 0 && (
        <details className="mt-2 px-3 py-2 rounded-md bg-surface/40">
          <summary className="text-warn cursor-pointer text-xs">
            {opSummary.data.orphans.length} orphan
            {opSummary.data.orphans.length === 1 ? "" : "s"} — path missing on
            disk
          </summary>
          <ul className="mt-2 max-h-64 overflow-auto space-y-1 text-[10px]">
            {opSummary.data.orphans.map((o) => (
              <li
                key={o.id}
                className="px-2 py-1 rounded bg-bg/50 flex items-start gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-fg">
                    {o.artist}{" "}
                    <span className="text-muted">·</span> {o.title}
                  </div>
                  <div className="text-muted font-mono break-all">
                    {o.filePath}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    onClick={(e) => relocateOrphan(e, o)}
                    className="px-2 py-1 rounded bg-mauve/15 text-mauve
                               hover:bg-mauve hover:text-bg text-[10px]
                               font-medium transition-colors"
                    title="Pick the new directory for this release"
                  >
                    Locate…
                  </button>
                  <button
                    onClick={(e) => deleteOrphan(e, o)}
                    className="px-2 py-1 rounded text-muted hover:text-alert
                               text-[10px] font-medium transition-colors"
                    title="Remove this orphaned row from the database"
                  >
                    delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ul className="mt-1 flex-1 overflow-auto rounded-md
                     divide-y divide-surface/60 bg-bg/50
                     max-h-[calc(100vh-310px)]
                     [scrollbar-gutter:stable]">
        {items.length === 0 && !loading && !error && (
          <li className="px-3 py-3 text-muted text-xs">
            {needsCoverOnly
              ? "All releases in this view have cover art."
              : "Empty library — add your first release on the right."}
          </li>
        )}
        {items.map((r) => {
          const thumb = coverImageSrc(r);
          const showInlineEditor = needsCoverOnly && r.id !== undefined;
          const draftValue = r.id !== undefined ? drafts.get(r.id) ?? "" : "";
          const saveDisabled =
            !draftValue.trim() || savingId !== null;
          return (
            <li
              key={r.id}
              onClick={() => onSelect(r)}
              className={cn(
                "px-3 py-2 cursor-pointer hover:bg-surface/40 text-xs",
                "flex flex-col gap-1.5",
                selected?.id === r.id && "bg-surface/70",
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className="shrink-0 w-9 h-9 rounded bg-surface overflow-hidden
                             flex items-center justify-center"
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          "none";
                      }}
                    />
                  ) : (
                    <Disc3 size={14} className="text-muted/60" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate",
                      selected?.id === r.id ? "text-accent" : "text-fg",
                    )}
                  >
                    {r.artist} <span className="text-muted">·</span> {r.title}
                  </div>
                  <div className="text-muted text-[10px] truncate">
                    {[r.year, r.format, r.label, r.catalogNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {r.medium && (
                  <span
                    className={cn(
                      "shrink-0 text-[10px] px-1.5 py-0.5 rounded",
                      r.medium === "digital"
                        ? "bg-accent/20 text-accent"
                        : "bg-ok/20 text-ok",
                    )}
                  >
                    {r.medium}
                  </span>
                )}
              </div>

              {showInlineEditor && (
                <div
                  className="flex gap-1.5 items-center pl-11"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={(el) => {
                      if (r.id !== undefined) {
                        if (el) inputRefs.current.set(r.id, el);
                        else inputRefs.current.delete(r.id);
                      }
                    }}
                    type="text"
                    value={draftValue}
                    onChange={(e) =>
                      r.id !== undefined && setDraft(r.id, e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (r.id !== undefined) saveCover(r.id);
                      }
                    }}
                    placeholder="https://i.nostr.build/…"
                    className="flex-1 px-2 py-1 rounded bg-surface text-fg
                               text-[10px] font-mono outline-none border
                               border-transparent focus:border-accent/50"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (r.id !== undefined) saveCover(r.id);
                    }}
                    disabled={saveDisabled}
                    className="px-2 py-1 rounded bg-accent text-bg font-semibold
                               hover:opacity-90 disabled:opacity-50
                               disabled:cursor-not-allowed text-[10px]"
                  >
                    {savingId === r.id ? "…" : "save"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
