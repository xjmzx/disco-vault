import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Section } from "./Section";
import { getStats, type Stats } from "../lib/tauri";

export function StatsPanel({ reloadKey }: { reloadKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => setStats(null));
  }, [reloadKey]);

  return (
    <Section title="Library stats" icon={<BarChart3 size={16} />}>
      {!stats ? (
        <p className="text-xs text-muted">no data yet</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 text-xs">
          <Stat label="total" value={stats.total} />
          <Stat label="physical" value={stats.physical} />
          <Stat label="digital" value={stats.digital} />
          <Stat label="artists" value={stats.uniqueArtists} />
          <Stat
            label="year range"
            value={
              stats.yearMin && stats.yearMax
                ? `${stats.yearMin}–${stats.yearMax}`
                : "—"
            }
            wide
          />
        </div>
      )}
    </Section>
  );
}

function Stat({
  label,
  value,
  wide,
}: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div
      className={
        "rounded-md bg-bg/50 px-3 py-2 flex flex-col gap-0.5 " +
        (wide ? "col-span-2" : "")
      }
    >
      <span className="text-muted text-[10px] uppercase tracking-wide">
        {label}
      </span>
      <span className="text-accent font-mono text-base">{value}</span>
    </div>
  );
}
