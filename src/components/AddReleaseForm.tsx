import { FormEvent, useState } from "react";
import { ChevronDown, Plus, Save } from "lucide-react";
import { Section } from "./Section";
import { addRelease, type Release } from "../lib/tauri";

interface Props {
  onAdded: () => void;
}

const EMPTY: Release = {
  artist: "",
  title: "",
  year: null,
  medium: "physical",
  format: "",
  label: "",
  catalogNumber: "",
  country: "",
  condition: "",
  notes: "",
  source: "",
  coverArtUrl: "",
};

export function AddReleaseForm({ onAdded }: Props) {
  const [release, setRelease] = useState<Release>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Release>(key: K, value: Release[K]) {
    setRelease((r) => ({ ...r, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!release.artist.trim() || !release.title.trim()) {
      setError("artist and title are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addRelease({
        ...release,
        artist: release.artist.trim(),
        title: release.title.trim(),
      });
      setRelease(EMPTY);
      onAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Add release" icon={<Plus size={16} />}>
      <form
        onSubmit={onSubmit}
        className="grid grid-cols-2 gap-3 text-xs"
      >
        <Field label="artist *" value={release.artist}
               onChange={(v) => set("artist", v)} className="col-span-2" />
        <Field label="title *" value={release.title}
               onChange={(v) => set("title", v)} className="col-span-2" />

        <NumField label="year" value={release.year ?? null}
                  onChange={(v) => set("year", v)} />
        <SelectField
          label="medium"
          value={release.medium ?? ""}
          onChange={(v) => set("medium", (v || null) as Release["medium"])}
          options={[
            { value: "", label: "—" },
            { value: "physical", label: "physical" },
            { value: "digital", label: "digital" },
          ]}
        />

        <Field label="format (LP, CD, FLAC, …)" value={release.format ?? ""}
               onChange={(v) => set("format", v)} />
        <Field label="condition (M, NM, VG+, …)"
               value={release.condition ?? ""}
               onChange={(v) => set("condition", v)} />

        <Field label="label" value={release.label ?? ""}
               onChange={(v) => set("label", v)} />
        <Field label="catalog #" value={release.catalogNumber ?? ""}
               onChange={(v) => set("catalogNumber", v)} />

        <Field label="country" value={release.country ?? ""}
               onChange={(v) => set("country", v)} />
        <Field label="source URL" value={release.source ?? ""}
               onChange={(v) => set("source", v)} />

        <Field label="cover URL (e.g. nostr.build / Blossom)"
               value={release.coverArtUrl ?? ""}
               onChange={(v) => set("coverArtUrl", v)}
               className="col-span-2" />

        <TextArea label="notes" value={release.notes ?? ""}
                  onChange={(v) => set("notes", v)} className="col-span-2" />

        {error && (
          <div className="col-span-2 text-alert text-xs">{error}</div>
        )}

        <div className="col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-md bg-accent text-bg font-semibold
                       hover:opacity-90 disabled:opacity-50
                       flex items-center gap-1.5"
          >
            <Save size={14} /> {saving ? "saving…" : "Save"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function inputCls() {
  return "px-2 py-1.5 rounded-md bg-surface text-fg outline-none " +
         "border border-transparent focus:border-accent/50 placeholder:text-muted";
}

function Field({
  label, value, onChange, className,
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={"flex flex-col gap-1 " + (className ?? "")}>
      <span className="text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls()}
        spellCheck={false}
      />
    </label>
  );
}

function NumField({
  label, value, onChange,
}: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className={inputCls()}
      />
    </label>
  );
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none w-full pl-2.5 pr-7 py-1.5 rounded-md
                     bg-accent text-bg font-semibold outline-none
                     border border-transparent focus:border-fg/30 cursor-pointer"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          strokeWidth={2.5}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-bg
                     pointer-events-none"
        />
      </div>
    </label>
  );
}

function TextArea({
  label, value, onChange, className,
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={"flex flex-col gap-1 " + (className ?? "")}>
      <span className="text-muted">{label}</span>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls() + " resize-none"}
      />
    </label>
  );
}
