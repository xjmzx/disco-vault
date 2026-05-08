import { useEffect, useState } from "react";
import { Disc3, RefreshCw, Search } from "lucide-react";
import { Section } from "./Section";
import { listReleases, type Release } from "../lib/tauri";
import { cn } from "../lib/cn";

interface Props {
  reloadKey: number;
  onSelect: (r: Release) => void;
  selected: Release | null;
}

type MediumFilter = "" | "physical" | "digital";

export function ReleaseList({ reloadKey, onSelect, selected }: Props) {
  const [query, setQuery] = useState("");
  const [medium, setMedium] = useState<MediumFilter>("");
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const list = await listReleases(query, medium || undefined);
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
  }, [reloadKey, medium]);

  return (
    <Section
      title="Library"
      icon={<Disc3 size={16} />}
      right={
        <span className="text-xs text-muted">
          {items.length} {items.length === 1 ? "release" : "releases"}
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
        <select
          value={medium}
          onChange={(e) => setMedium(e.target.value as MediumFilter)}
          className="px-2 py-2 rounded-md bg-surface text-fg text-xs outline-none
                     border border-transparent focus:border-accent/50"
        >
          <option value="">all</option>
          <option value="physical">physical</option>
          <option value="digital">digital</option>
        </select>
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

      <ul className="mt-1 flex-1 overflow-auto rounded-md
                     divide-y divide-surface/60 bg-bg/50 max-h-[60vh]">
        {items.length === 0 && !loading && !error && (
          <li className="px-3 py-3 text-muted text-xs">
            Empty library — add your first release on the right.
          </li>
        )}
        {items.map((r) => (
          <li
            key={r.id}
            onClick={() => onSelect(r)}
            className={cn(
              "px-3 py-2 cursor-pointer hover:bg-surface/40 text-xs",
              "flex justify-between items-center gap-2",
              selected?.id === r.id && "bg-surface/70",
            )}
          >
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
          </li>
        ))}
      </ul>
    </Section>
  );
}
