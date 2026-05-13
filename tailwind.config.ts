import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Catppuccin Mocha — same palette as bpm-tapper, FLAC browser, smpl-tool.
        // `bg` is pure black for the outer page surround; `panel` keeps the
        // Catppuccin base tone for the actual content cards.
        bg: "#000000",
        panel: "#0e0e18",
        surface: "#232434",
        surfaceHover: "#45475a",
        fg: "#cdd6f4",
        muted: "#6c7086",
        accent: "#89b4fa",
        ok: "#a6e3a1",
        warn: "#f9e2af",
        alert: "#f38ba8",
        mauve: "#cba6f7",
      },
      fontFamily: {
        sans: ["Helvetica", "Arial", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
