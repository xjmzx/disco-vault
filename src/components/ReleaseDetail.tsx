import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileMusic,
  ImageDown,
  Image as ImageIcon,
  Pencil,
  RefreshCcw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Section } from "./Section";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
import { coverImageSrc } from "../lib/cover";
import {
  deleteRelease,
  publishRelease,
  refreshRelease,
  setCoverArtUrl,
  syncCoverToDisk,
  unpublishRelease,
  type CoverSyncResult,
  type PublishResult,
  type RefreshResult,
  type Release,
} from "../lib/tauri";

interface Props {
  release: Release;
  relays: string[];
  onDeleted: () => void;
  onChanged: (updated: Release) => void;
}

type PublishAction = "publish" | "unpublish";

export function ReleaseDetail({ release, relays, onDeleted, onChanged }: Props) {
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(
    null,
  );
  const [lastAction, setLastAction] = useState<PublishAction | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [editingCover, setEditingCover] = useState(false);
  const [coverDraft, setCoverDraft] = useState("");
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [syncingCover, setSyncingCover] = useState(false);
  const [syncResult, setSyncResult] = useState<CoverSyncResult | null>(null);
  const [interopError, setInteropError] = useState<string | null>(null);

  // Reset publish + cover state when switching to a different release.
  useEffect(() => {
    setPublishResult(null);
    setLastAction(null);
    setPublishError(null);
    setEditingCover(false);
    setCoverDraft("");
    setCoverError(null);
    setRefreshResult(null);
    setSyncResult(null);
    setInteropError(null);
  }, [release.id]);

  async function saveCoverUrl() {
    if (!release.id) return;
    setCoverSaving(true);
    setCoverError(null);
    try {
      const trimmed = coverDraft.trim();
      const next = trimmed.length > 0 ? trimmed : null;
      await setCoverArtUrl(release.id, next);
      setEditingCover(false);
      setCoverDraft("");
      onChanged({ ...release, coverArtUrl: next });
    } catch (e) {
      setCoverError(String(e));
    } finally {
      setCoverSaving(false);
    }
  }

  async function clearCoverUrl() {
    if (!release.id) return;
    if (!confirm("Clear the cover URL for this release?")) return;
    setCoverSaving(true);
    setCoverError(null);
    try {
      await setCoverArtUrl(release.id, null);
      setEditingCover(false);
      setCoverDraft("");
      onChanged({ ...release, coverArtUrl: null });
    } catch (e) {
      setCoverError(String(e));
    } finally {
      setCoverSaving(false);
    }
  }

  const coverSrc = coverImageSrc(release);

  async function onDelete() {
    if (!release.id) return;
    if (!confirm(`Delete "${release.artist} — ${release.title}"?`)) return;
    try {
      await deleteRelease(release.id);
      onDeleted();
    } catch (e) {
      alert(String(e));
    }
  }

  async function onPublish() {
    if (!release.id) return;
    if (relays.length === 0) {
      setPublishError("Add at least one relay in the Nostr Sync panel.");
      return;
    }
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    setLastAction("publish");
    try {
      const result = await publishRelease(release.id, relays);
      setPublishResult(result);
    } catch (e) {
      setPublishError(String(e));
    } finally {
      setPublishing(false);
    }
  }

  async function onRefresh() {
    if (!release.id) return;
    setRefreshing(true);
    setRefreshResult(null);
    setInteropError(null);
    try {
      const result = await refreshRelease(release.id);
      setRefreshResult(result);
      if (result.status === "ok") {
        // Optimistically reflect the changes that matter to display.
        onChanged({ ...release });
      }
    } catch (e) {
      setInteropError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function onSyncCover() {
    if (!release.id) return;
    setSyncingCover(true);
    setSyncResult(null);
    setInteropError(null);
    try {
      const result = await syncCoverToDisk(release.id);
      setSyncResult(result);
      if (result.status === "ok" && result.written) {
        onChanged({ ...release, coverArtPath: result.written });
      }
    } catch (e) {
      setInteropError(String(e));
    } finally {
      setSyncingCover(false);
    }
  }

  async function onUnpublish() {
    if (!release.id) return;
    if (relays.length === 0) {
      setPublishError("Add at least one relay in the Nostr Sync panel.");
      return;
    }
    if (
      !confirm(
        `Send NIP-09 deletion request for "${release.artist} — ${release.title}"?\n\nThis asks every configured relay to remove the published event. Well-behaved relays honour it; some may ignore the request.`,
      )
    ) {
      return;
    }
    setUnpublishing(true);
    setPublishError(null);
    setPublishResult(null);
    setLastAction("unpublish");
    try {
      const result = await unpublishRelease(release.id, relays);
      setPublishResult(result);
    } catch (e) {
      setPublishError(String(e));
    } finally {
      setUnpublishing(false);
    }
  }

  const fields: [string, unknown][] = [
    ["year", release.year],
    ["medium", release.medium],
    ["format", release.format],
    ["label", release.label],
    ["catalog #", release.catalogNumber],
    ["country", release.country],
    ["condition", release.condition],
    ["source", release.source],
    ["file path", release.filePath],
    ["discogs id", release.discogsId],
    ["musicbrainz id", release.musicbrainzId],
  ];

  return (
    <Section
      title={
        <>
          <span className="text-fg">{release.artist} /</span>{" "}
          <span className="text-accent">{release.title}</span>
        </>
      }
      icon={<FileMusic size={16} />}
      right={
        <button
          onClick={onDelete}
          className="text-muted hover:text-alert text-xs flex items-center gap-1"
        >
          <Trash2 size={12} /> delete
        </button>
      }
    >
      <div className="flex gap-3 items-start">
        <CoverArt
          src={coverSrc}
          alt={`${release.artist} — ${release.title}`}
          editing={editingCover}
          coverDraft={coverDraft}
          coverSaving={coverSaving}
          hasUrl={Boolean(release.coverArtUrl?.trim())}
          onStartEdit={() => {
            setCoverDraft(release.coverArtUrl ?? "");
            setEditingCover(true);
          }}
          onCancelEdit={() => {
            setEditingCover(false);
            setCoverDraft("");
            setCoverError(null);
          }}
          onChangeDraft={setCoverDraft}
          onSave={saveCoverUrl}
          onClear={clearCoverUrl}
        />
        <div className="min-w-0 flex-1">
          {coverError && (
            <div className="text-alert text-[10px]">{coverError}</div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs mt-3">
        {fields.map(([label, value]) =>
          value == null || value === "" ? null : (
            <DLRow key={label} label={label} value={String(value)} />
          ),
        )}
      </dl>

      {release.notes && (
        <div className="mt-3 text-xs">
          <div className="text-muted mb-1">notes</div>
          <p className="whitespace-pre-wrap text-fg/90">{release.notes}</p>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-surface/60">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onPublish}
            disabled={publishing || unpublishing || relays.length === 0}
            className={`${DB_BUTTON_CLS} disabled:opacity-50 disabled:cursor-not-allowed`}
            title={
              relays.length === 0
                ? "Add a relay in the Nostr Sync panel first"
                : "Publish this release as a kind:31237 event"
            }
          >
            <Upload size={14} />
            {publishing ? "publishing…" : "Publish to Nostr"}
          </button>
          <button
            onClick={onUnpublish}
            disabled={publishing || unpublishing || relays.length === 0}
            className={`${DB_BUTTON_CLS} disabled:opacity-50 disabled:cursor-not-allowed`}
            title="Send NIP-09 deletion request for the published event"
          >
            <Undo2 size={14} />
            {unpublishing ? "unpublishing…" : "Unpublish"}
          </button>
          {release.filePath && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className={`${DB_BUTTON_CLS} disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Re-read tags + cover from the release's local directory"
            >
              <RefreshCcw size={14} />
              {refreshing ? "refreshing…" : "Refresh from disk"}
            </button>
          )}
          {release.filePath && release.coverArtUrl && (
            <button
              onClick={onSyncCover}
              disabled={syncingCover}
              className={`${DB_BUTTON_CLS} disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Download the published cover URL and save it as cover.jpg in the release folder"
            >
              <ImageDown size={14} />
              {syncingCover ? "downloading…" : "Sync cover to disk"}
            </button>
          )}
        </div>

        {interopError && (
          <div className="mt-2 text-alert text-xs">{interopError}</div>
        )}
        {refreshResult && (
          <div className="mt-2 text-xs">
            {refreshResult.status === "ok" && (
              <span className="text-ok">
                refreshed: {refreshResult.changes.join(", ")}
              </span>
            )}
            {refreshResult.status === "no_changes" && (
              <span className="text-muted">no changes — DB already current</span>
            )}
            {refreshResult.status === "missing_path" && (
              <span className="text-warn">file path missing on disk</span>
            )}
            {refreshResult.status === "no_audio" && (
              <span className="text-warn">no audio files in directory</span>
            )}
            {refreshResult.status === "no_path" && (
              <span className="text-muted">release has no file path</span>
            )}
          </div>
        )}
        {syncResult && (
          <div className="mt-2 text-xs">
            {syncResult.status === "ok" && syncResult.written && (
              <span className="text-ok">
                wrote {(syncResult.bytes ?? 0) / 1024 < 1024
                  ? `${Math.round((syncResult.bytes ?? 0) / 1024)} KB`
                  : `${((syncResult.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`}
                {" → "}
                <span className="font-mono text-muted break-all">
                  {syncResult.written}
                </span>
              </span>
            )}
            {syncResult.status === "no_url" && (
              <span className="text-muted">no cover URL to sync</span>
            )}
            {syncResult.status === "no_path" && (
              <span className="text-muted">release has no file path</span>
            )}
            {syncResult.status === "missing_path" && (
              <span className="text-warn">file path missing on disk</span>
            )}
          </div>
        )}

        {publishError && (
          <div className="mt-2 text-alert text-xs">{publishError}</div>
        )}

        {publishResult && (
          <div className="mt-2 text-xs space-y-2">
            {lastAction === "publish" && publishResult.naddr && (
              <NaddrRow naddr={publishResult.naddr} />
            )}

            <details className="text-muted">
              <summary className="cursor-pointer">
                {lastAction === "unpublish"
                  ? "deletion request id"
                  : "event id"}{" "}
                <span className="font-mono text-fg/60">
                  {publishResult.eventId.slice(0, 16)}…
                </span>
              </summary>
              <div className="mt-1 font-mono text-[10px] text-fg/70 break-all">
                {publishResult.eventId}
              </div>
            </details>

            {publishResult.acceptedBy.length > 0 && (
              <div className="text-ok">
                {lastAction === "unpublish" ? "delete request " : ""}
                accepted by {publishResult.acceptedBy.length} of{" "}
                {publishResult.acceptedBy.length +
                  publishResult.rejected.length}
                :{" "}
                <span className="font-mono">
                  {publishResult.acceptedBy.join(", ")}
                </span>
              </div>
            )}
            {publishResult.rejected.length > 0 && (
              <details>
                <summary className="text-warn cursor-pointer">
                  {publishResult.rejected.length} relay
                  {publishResult.rejected.length === 1 ? "" : "s"} rejected
                </summary>
                <ul className="mt-1 font-mono text-[10px] text-alert/90 space-y-0.5">
                  {publishResult.rejected.map((r, i) => (
                    <li key={i} className="break-all">
                      {r.relay} — {r.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function DLRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-fg/90 truncate" title={value}>
        {value}
      </dd>
    </>
  );
}

interface CoverArtProps {
  src: string | null;
  alt: string;
  editing: boolean;
  coverDraft: string;
  coverSaving: boolean;
  hasUrl: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeDraft: (v: string) => void;
  onSave: () => void;
  onClear: () => void;
}

function CoverArt({
  src,
  alt,
  editing,
  coverDraft,
  coverSaving,
  hasUrl,
  onStartEdit,
  onCancelEdit,
  onChangeDraft,
  onSave,
  onClear,
}: CoverArtProps) {
  return (
    <div className="shrink-0 w-[195px]">
      <div className="relative w-[195px] h-[195px] rounded-md bg-surface
                      overflow-hidden flex items-center justify-center">
        {src ? (
          <img
            src={src}
            alt={alt}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="text-muted flex flex-col items-center gap-1 text-[10px]">
            <ImageIcon size={28} strokeWidth={1.5} />
            <span>no cover</span>
          </div>
        )}
        {!editing && (
          <button
            onClick={onStartEdit}
            className="absolute bottom-1 right-1 px-1.5 py-1 rounded
                       bg-bg/80 hover:bg-bg text-fg/90 flex items-center
                       gap-1 text-[10px]"
            title="Set cover URL"
          >
            <Pencil size={10} />
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-1.5 space-y-1">
          <input
            type="text"
            value={coverDraft}
            onChange={(e) => onChangeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancelEdit();
            }}
            placeholder="https://i.nostr.build/…"
            className="w-full px-2 py-1 rounded bg-surface text-fg text-[10px]
                       font-mono outline-none border border-transparent
                       focus:border-accent/50"
            spellCheck={false}
            autoFocus
          />
          <div className="flex gap-1 text-[10px]">
            <button
              onClick={onSave}
              disabled={coverSaving}
              className="px-2 py-1 rounded bg-accent text-bg font-semibold
                         hover:opacity-90 disabled:opacity-50 flex-1"
            >
              save
            </button>
            <button
              onClick={onCancelEdit}
              disabled={coverSaving}
              className="px-2 py-1 rounded bg-surface hover:bg-surfaceHover
                         text-fg disabled:opacity-50"
            >
              cancel
            </button>
            {hasUrl && (
              <button
                onClick={onClear}
                disabled={coverSaving}
                className="px-2 py-1 rounded bg-surface hover:bg-surfaceHover
                           text-muted hover:text-alert disabled:opacity-50"
              >
                clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NaddrRow({ naddr }: { naddr: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(naddr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function viewOnNostrBand() {
    try {
      await openUrl(`https://nostr.band/${naddr}`);
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted mb-1">
        share link · NIP-19 naddr
      </div>
      <div className="flex items-center gap-2">
        <code
          className="flex-1 px-2 py-1.5 rounded bg-surface text-fg/80
                     text-[10px] font-mono break-all"
          title={naddr}
        >
          {naddr}
        </code>
        <button
          onClick={copy}
          className="px-2 py-1.5 rounded bg-surface hover:bg-surfaceHover
                     text-fg flex items-center gap-1 text-[10px]"
          title="Copy naddr to clipboard"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
        <button
          onClick={viewOnNostrBand}
          className="px-2 py-1.5 rounded bg-surface hover:bg-surfaceHover
                     text-fg flex items-center gap-1 text-[10px]"
          title="View on nostr.band"
        >
          <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}
