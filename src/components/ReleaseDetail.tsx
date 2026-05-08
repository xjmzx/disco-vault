import { Trash2, FileMusic } from "lucide-react";
import { Section } from "./Section";
import { deleteRelease, type Release } from "../lib/tauri";

interface Props {
  release: Release;
  onDeleted: () => void;
}

export function ReleaseDetail({ release, onDeleted }: Props) {
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
      title={release.title}
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
      <div className="text-fg font-semibold text-base">{release.artist}</div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs mt-2">
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
