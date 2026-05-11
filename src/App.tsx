import { useEffect, useState } from "react";
import { RotateCw, FolderOpen, FilePlus } from "lucide-react";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { ReleaseList } from "./components/ReleaseList";
import { ReleaseDetail } from "./components/ReleaseDetail";
import { AddReleaseForm } from "./components/AddReleaseForm";
import { StatsPanel } from "./components/StatsPanel";
import { NostrPanel } from "./components/NostrPanel";
import { ImportPanel } from "./components/ImportPanel";
import {
  initDb,
  setDbPath as setDbPathCmd,
  type Release,
} from "./lib/tauri";

const DB_FILTERS = [{ name: "SQLite", extensions: ["db", "sqlite"] }];

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

const RELAYS_STORAGE_KEY = "disco-vault.relays";

export default function App() {
  const [selected, setSelected] = useState<Release | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [relays, setRelays] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RELAYS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
          return parsed;
        }
      }
    } catch {
      /* fall through to defaults */
    }
    return DEFAULT_RELAYS;
  });

  useEffect(() => {
    initDb()
      .then(setDbPath)
      .catch((e) => setDbError(String(e)));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(RELAYS_STORAGE_KEY, JSON.stringify(relays));
    } catch {
      /* ignore */
    }
  }, [relays]);

  function reload() {
    setReloadKey((k) => k + 1);
    setSelected(null);
  }

  function handleReleaseChanged(updated: Release) {
    setSelected(updated);
    setReloadKey((k) => k + 1);
  }

  async function switchDbTo(newPath: string) {
    setDbError(null);
    try {
      const updated = await setDbPathCmd(newPath);
      setDbPath(updated);
      reload();
    } catch (e) {
      setDbError(String(e));
    }
  }

  async function onOpenDb() {
    const picked = await openDialog({
      multiple: false,
      filters: DB_FILTERS,
      title: "Open database",
    });
    if (typeof picked === "string") await switchDbTo(picked);
  }

  async function onNewDb() {
    const picked = await saveDialog({
      filters: DB_FILTERS,
      title: "Create new database",
      defaultPath: "discography.db",
    });
    if (typeof picked === "string") await switchDbTo(picked);
  }

  return (
    <div className="min-h-screen p-6 max-w-[1500px] mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-accent tracking-tight">
            disco<span className="text-fg">-vault</span>
          </h1>
          <p className="text-sm text-muted mt-1">
            physical & digital music collection · search · share via Nostr
          </p>
        </div>
        <div className="text-xs text-muted text-right">
          {dbError ? (
            <span className="text-alert font-mono break-all">{dbError}</span>
          ) : dbPath ? (
            <>
              <div className="flex items-center justify-end gap-2 text-[10px] uppercase tracking-wide">
                <span>db</span>
                <DbIconButton title="Refresh" onClick={reload}>
                  <RotateCw size={12} />
                </DbIconButton>
                <DbIconButton title="Open existing database…" onClick={onOpenDb}>
                  <FolderOpen size={12} />
                </DbIconButton>
                <DbIconButton title="Create new database…" onClick={onNewDb}>
                  <FilePlus size={12} />
                </DbIconButton>
              </div>
              <div className="font-mono">{dbPath}</div>
            </>
          ) : (
            "initialising…"
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
        <div className="grid grid-cols-1 gap-4 content-start">
          <StatsPanel reloadKey={reloadKey} />
          <ImportPanel onImported={reload} />
          <ReleaseList
            reloadKey={reloadKey}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 content-start">
          {selected ? (
            <ReleaseDetail
              release={selected}
              relays={relays}
              onDeleted={reload}
              onChanged={handleReleaseChanged}
            />
          ) : (
            <AddReleaseForm onAdded={reload} />
          )}
          <NostrPanel relays={relays} setRelays={setRelays} />
        </div>
      </div>

      <footer className="mt-8 text-xs text-muted">
        <span>scaffold · stack: Tauri 2 + React + TypeScript + Tailwind + SQLite</span>
      </footer>
    </div>
  );
}

function DbIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-1 rounded hover:bg-surface text-muted hover:text-fg
                 transition-colors"
    >
      {children}
    </button>
  );
}
