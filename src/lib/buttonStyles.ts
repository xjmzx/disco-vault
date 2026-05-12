// Shared mauve-tinted secondary-button style. Used by the DB controls in the
// app header and any other "tool-tier" action that should look adjacent in
// the visual hierarchy (Import, Publish, relay management, etc.). Solid blue
// `bg-accent` buttons stay reserved for primary content actions like Save.

export const DB_BUTTON_CLS =
  "px-3 py-1.5 rounded-md bg-mauve/15 text-mauve " +
  "hover:bg-mauve hover:text-bg transition-colors " +
  "flex items-center gap-1.5 text-xs font-medium";

export const DB_ICON_BUTTON_CLS =
  "p-2 rounded-md bg-mauve/15 text-mauve " +
  "hover:bg-mauve hover:text-bg transition-colors";
