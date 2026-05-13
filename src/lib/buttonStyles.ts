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

// Minimal pill-outline used for low-prominence destructive/exit actions that
// live at the edges of panels (Delete release, Forget identity). Muted at rest
// so they don't pull the eye; light-mauve hover keeps them inside the palette.
export const SUBTLE_BUTTON_CLS =
  "px-2.5 py-1 rounded-full text-xs flex items-center gap-1.5 " +
  "text-muted border border-muted/30 transition-colors " +
  "hover:text-mauve hover:border-mauve/50 hover:bg-mauve/10";
