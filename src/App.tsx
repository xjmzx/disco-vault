import { useEffect, useState } from "react";
import { ReleaseList } from "./components/ReleaseList";
import { ReleaseDetail } from "./components/ReleaseDetail";
import { AddReleaseForm } from "./components/AddReleaseForm";
import { StatsPanel } from "./components/StatsPanel";
import { NostrPanel } from "./components/NostrPanel";
import { initDb, type Release } from "./lib/tauri";

export default function App() {
  const [selected, setSelected] = useState<Release | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initDb()
      .then(setDbPath)
      .catch((e) => setDbError(String(e)));
  }, []);

  function reload() {
    setReloadKey((k) => k + 1);
    setSelected(null);
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
              <div className="text-[10px] uppercase tracking-wide">db</div>
              <div className="font-mono">{dbPath}</div>
            </>
          ) : (
            "initialising…"
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
        <ReleaseList
          reloadKey={reloadKey}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="grid grid-cols-1 gap-4">
          {selected ? (
            <ReleaseDetail release={selected} onDeleted={reload} />
          ) : (
            <AddReleaseForm onAdded={reload} />
          )}
          <StatsPanel reloadKey={reloadKey} />
          <NostrPanel />
        </div>
      </div>

      <footer className="mt-8 text-xs text-muted">
        <span>scaffold · stack: Tauri 2 + React + TypeScript + Tailwind + SQLite</span>
      </footer>
    </div>
  );
}
