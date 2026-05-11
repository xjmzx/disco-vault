import { useState } from "react";
import { Disc, FolderInput, Play, RotateCcw } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Section } from "./Section";
import {
  importDirectory,
  importDiscogsCsv,
  scanDirectory,
  scanDiscogsCsv,
  type ImportProgress,
  type ImportSummary,
  type ScanDiscogsReport,
  type ScanReport,
} from "../lib/tauri";

interface Props {
  onImported: () => void;
}

type Phase = "idle" | "scanning" | "ready" | "importing" | "done";

type ScanResult =
  | { kind: "folder"; report: ScanReport }
  | { kind: "discogs"; report: ScanDiscogsReport };

export function ImportPanel({ onImported }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [last, setLast] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setPickedPath(null);
    setScan(null);
    setProgress(null);
    setLast(null);
    setError(null);
  }

  async function pickFolder() {
    setError(null);
    let picked: string | null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Select your music library folder",
      });
      picked = typeof result === "string" ? result : null;
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!picked) return;

    setPickedPath(picked);
    setLast(null);
    setProgress(null);
    setPhase("scanning");
    try {
      const report = await scanDirectory(picked);
      setScan({ kind: "folder", report });
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }

  async function pickDiscogsCsv() {
    setError(null);
    let picked: string | null;
    try {
      const result = await openDialog({
        multiple: false,
        title: "Select your Discogs collection CSV export",
        filters: [{ name: "Discogs CSV", extensions: ["csv"] }],
      });
      picked = typeof result === "string" ? result : null;
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!picked) return;

    setPickedPath(picked);
    setLast(null);
    setProgress(null);
    setPhase("scanning");
    try {
      const report = await scanDiscogsCsv(picked);
      setScan({ kind: "discogs", report });
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }

  async function runImport() {
    if (!pickedPath || !scan) return;
    setError(null);
    setLast(null);
    setPhase("importing");

    const totalGuess =
      scan.kind === "folder" ? scan.report.totalDirs : scan.report.totalRows;
    setProgress({ current: 0, total: totalGuess, currentDir: "" });

    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<number>("import:started", (e) => {
          setProgress((p) => ({
            current: p?.current ?? 0,
            total: e.payload,
            currentDir: p?.currentDir ?? "",
          }));
        }),
      );
      unlisteners.push(
        await listen<ImportProgress>("import:progress", (e) => {
          setProgress(e.payload);
        }),
      );

      const summary =
        scan.kind === "folder"
          ? await importDirectory(pickedPath)
          : await importDiscogsCsv(pickedPath);
      setLast(summary);
      setPhase("done");
      onImported();
    } catch (e) {
      setError(String(e));
      setPhase("ready");
    } finally {
      unlisteners.forEach((f) => f());
    }
  }

  return (
    <Section title="Import library" icon={<FolderInput size={16} />}>
      {phase === "idle" && (
        <>
          <p className="text-xs text-muted">
            Pick a source to bring releases into the library. Folder scan reads
            audio tags from files (digital). Discogs CSV imports your owned
            collection (mostly physical). Re-running either source skips items
            already present.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={pickFolder}
              className="px-3 py-2 rounded-md bg-accent text-bg font-semibold
                         hover:opacity-90 flex items-center gap-2 text-xs"
            >
              <FolderInput size={14} /> Folder (digital)
            </button>
            <button
              onClick={pickDiscogsCsv}
              className="px-3 py-2 rounded-md bg-accent text-bg font-semibold
                         hover:opacity-90 flex items-center gap-2 text-xs"
            >
              <Disc size={14} /> Discogs CSV (physical)
            </button>
          </div>
          {error && <div className="mt-2 text-alert text-xs">{error}</div>}
        </>
      )}

      {phase === "scanning" && (
        <div className="text-xs text-muted">
          scanning <span className="font-mono text-fg/80">{pickedPath}</span>…
        </div>
      )}

      {phase === "ready" && scan && (
        <>
          <div className="text-[10px] font-mono text-muted break-all">
            {pickedPath}
          </div>
          {scan.kind === "folder" ? (
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <Stat label="folders" value={scan.report.totalDirs.toLocaleString()} />
              <Stat label="files" value={scan.report.totalFiles.toLocaleString()} />
              <Stat label="size" value={formatBytes(scan.report.totalBytes)} />
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
              <Stat label="rows" value={scan.report.totalRows.toLocaleString()} />
              <Stat
                label="physical"
                value={scan.report.physical.toLocaleString()}
                tone="ok"
              />
              <Stat
                label="digital"
                value={scan.report.digital.toLocaleString()}
                tone="ok"
              />
              <Stat
                label="w/ cond"
                value={scan.report.withCondition.toLocaleString()}
                tone="muted"
              />
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={runImport}
              className="px-4 py-2 rounded-md bg-accent text-bg font-semibold
                         hover:opacity-90 flex items-center gap-2 text-xs"
            >
              <Play size={14} /> Import{" "}
              {(scan.kind === "folder"
                ? scan.report.totalDirs
                : scan.report.totalRows
              ).toLocaleString()}{" "}
              {scan.kind === "folder" ? "releases" : "rows"}
            </button>
            <button
              onClick={reset}
              className="px-3 py-2 rounded-md bg-surface hover:bg-surfaceHover
                         text-fg flex items-center gap-1.5 text-xs"
            >
              <RotateCcw size={12} /> cancel
            </button>
          </div>
          {error && <div className="mt-2 text-alert text-xs">{error}</div>}
        </>
      )}

      {phase === "importing" && progress && (
        <>
          <div className="text-[10px] font-mono text-muted break-all">
            {pickedPath}
          </div>
          <ProgressBar current={progress.current} total={progress.total || 1} />
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span className="font-mono">
              {progress.current.toLocaleString()} /{" "}
              {progress.total.toLocaleString()}
            </span>
            <span className="font-mono">
              {pct(progress.current, progress.total || 1)}%
            </span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-fg/70 truncate">
            {progress.currentDir}
          </div>
        </>
      )}

      {phase === "done" && last && (
        <>
          <div className="text-[10px] font-mono text-muted break-all">
            {pickedPath}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <Stat label="scanned" value={last.scanned.toLocaleString()} />
            <Stat
              label="imported"
              value={last.imported.toLocaleString()}
              tone="ok"
            />
            <Stat
              label="skipped"
              value={last.skipped.toLocaleString()}
              tone="muted"
            />
          </div>
          {last.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-warn cursor-pointer text-xs">
                {last.errors.length} warning
                {last.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 max-h-32 overflow-auto font-mono text-[10px]
                             text-alert/90 space-y-0.5">
                {last.errors.map((err, i) => (
                  <li key={i} className="break-all">
                    {err}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            onClick={reset}
            className="mt-3 px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                       text-fg flex items-center gap-1.5 text-xs"
          >
            <FolderInput size={12} /> import another source
          </button>
        </>
      )}
    </Section>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  return (
    <div className="mt-2 h-2 rounded-full bg-surface overflow-hidden">
      <div
        className="h-full bg-accent transition-[width] duration-150"
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "muted";
}) {
  const valueCls =
    tone === "ok" ? "text-ok" : tone === "muted" ? "text-muted" : "text-fg";
  return (
    <div className="rounded-md bg-surface/50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`font-mono text-sm ${valueCls}`}>{value}</div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function pct(current: number, total: number): string {
  if (total <= 0) return "0";
  return ((current / total) * 100).toFixed(current === total ? 0 : 1);
}
