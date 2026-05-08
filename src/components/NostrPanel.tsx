import { useState } from "react";
import { Radio, Upload } from "lucide-react";
import { Section } from "./Section";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

export function NostrPanel() {
  const [relays, setRelays] = useState<string[]>(DEFAULT_RELAYS);
  const [newRelay, setNewRelay] = useState("");

  function addRelay() {
    const url = newRelay.trim();
    if (!url || relays.includes(url)) return;
    setRelays([...relays, url]);
    setNewRelay("");
  }

  return (
    <Section title="Sync · Nostr" icon={<Radio size={16} />}>
      <p className="text-xs text-muted">
        Publish your collection (or selected lists) to Nostr relays so other
        clients can subscribe and discover. Subscribe to other users' lists
        from the same relays.
      </p>

      <div className="mt-2">
        <div className="text-xs text-muted mb-1">Relays</div>
        <ul className="space-y-1 mb-2">
          {relays.map((r) => (
            <li
              key={r}
              className="px-2 py-1 rounded bg-bg/50 font-mono text-xs flex
                         items-center justify-between gap-2"
            >
              <span className="truncate">{r}</span>
              <button
                onClick={() => setRelays(relays.filter((x) => x !== r))}
                className="text-muted hover:text-alert text-xs"
                aria-label={`Remove ${r}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text"
            value={newRelay}
            onChange={(e) => setNewRelay(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRelay()}
            placeholder="wss://relay.example.com"
            className="flex-1 px-3 py-1.5 rounded-md bg-surface text-fg
                       placeholder:text-muted outline-none border border-transparent
                       focus:border-accent/50 text-xs font-mono"
            spellCheck={false}
          />
          <button
            onClick={addRelay}
            disabled={!newRelay.trim()}
            className="px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                       text-fg disabled:opacity-50 text-xs"
          >
            Add
          </button>
        </div>
      </div>

      <button
        className="mt-3 w-full px-3 py-2.5 rounded-md bg-accent text-bg font-semibold
                   hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed
                   flex items-center justify-center gap-2"
        disabled
      >
        <Upload size={16} /> Publish library (not wired yet)
      </button>
    </Section>
  );
}
