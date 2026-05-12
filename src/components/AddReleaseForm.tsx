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
      <form onSubmit={onSubmit} className="text-xs space-y-1.5">
        <Field
          label="artist"
          value={release.artist}
          onChange={(v) => set("artist", v)}
        />
        <Field
          label="title"
          value={release.title}
          onChange={(v) => set("title", v)}
        />
        <NumField
          label="year"
          value={release.year ?? null}
          onChange={(v) => set("year", v)}
        />
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
        <Field
          label="format"
          value={release.format ?? ""}
          onChange={(v) => set("format", v)}
        />
        <Field
          label="condition"
          value={release.condition ?? ""}
          onChange={(v) => set("condition", v)}
        />
        <Field
          label="label"
          value={release.label ?? ""}
          onChange={(v) => set("label", v)}
        />
        <Field
          label="catalog"
          value={release.catalogNumber ?? ""}
          onChange={(v) => set("catalogNumber", v)}
        />
        <Field
          label="country"
          value={release.country ?? ""}
          onChange={(v) => set("country", v)}
        />
        <Field
          label="url"
          value={release.source ?? ""}
          onChange={(v) => set("source", v)}
        />
        <Field
          label="cover url"
          value={release.coverArtUrl ?? ""}
          onChange={(v) => set("coverArtUrl", v)}
        />
        <TextArea
          label="notes"
          value={release.notes ?? ""}
          onChange={(v) => set("notes", v)}
        />

        {error && <div className="text-alert text-xs pl-[6rem]">{error}</div>}

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded-md bg-accent text-bg font-semibold
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

const ROW = "grid grid-cols-[5.5rem_1fr] gap-x-3 items-center";
const INPUT_CLS =
  "px-2 py-1 rounded-md bg-surface text-fg outline-none " +
  "border border-transparent focus:border-accent/50 placeholder:text-muted";

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={ROW}>
      <span className="text-muted text-right">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
        spellCheck={false}
      />
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className={ROW}>
      <span className="text-muted text-right">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
        className={`${INPUT_CLS} w-24`}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className={ROW}>
      <span className="text-muted text-right">{label}</span>
      <div className="relative w-fit">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none pl-2.5 pr-7 py-1 rounded-md
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
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid grid-cols-[5.5rem_1fr] gap-x-3 items-start">
      <span className="text-muted text-right pt-1">{label}</span>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLS} resize-none`}
      />
    </label>
  );
}
