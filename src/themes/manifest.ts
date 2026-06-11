export type Appearance = "light" | "dark"

// `appearance: null` means the theme's appearance is derived at runtime.
// COSMIC palette themes below are auto-generated from .ron files; see
// src/themes/cosmic-generated.css and scripts/gen-themes.mjs.
export const themes = [
  { id: "cosmic-light", name: "COSMIC Light", appearance: "light" },
  { id: "black-pearl", name: "Black Pearl", appearance: "dark" },
  { id: "catppuccin-latte-lavender", name: "Catppuccin Latte Lavender", appearance: "light" },
  { id: "catppuccin-macchiato-green", name: "Catppuccin Macchiato Green", appearance: "dark" },
  {
    id: "catppuccin-macchiato-lavender",
    name: "Catppuccin Macchiato Lavender",
    appearance: "dark",
  },
  { id: "catppuccin-mocha-sky", name: "Catppuccin Mocha Sky", appearance: "dark" },
  { id: "cosmic-aero", name: "COSMIC Aero", appearance: "dark" },
  {
    id: "cosmic-cyberpunk-setting-theme",
    name: "Cosmic Cyberpunk Setting Theme",
    appearance: "dark",
  },
  { id: "cosmicwaita", name: "CosmicWaita", appearance: "light" },
  { id: "dark-liquid-glass", name: "Dark Liquid Glass", appearance: "dark" },
  { id: "dracula-purple", name: "Dracula Purple", appearance: "dark" },
  { id: "dracula", name: "Dracula", appearance: "dark" },
  { id: "dusklight", name: "Dusklight", appearance: "dark" },
  { id: "eientei-dark-red", name: "Eientei Dark Red", appearance: "dark" },
  { id: "elysium", name: "Elysium", appearance: "dark" },
  { id: "everforest-medium", name: "Everforest Medium", appearance: "dark" },
  { id: "everforest", name: "EverForest", appearance: "dark" },
  { id: "fedora-light", name: "Fedora Light", appearance: "light" },
  { id: "flexoki-dark", name: "Flexoki Dark", appearance: "dark" },
  { id: "gnome-adwaita-dark", name: "GNOME Adwaita Dark", appearance: "dark" },
  { id: "gotham", name: "Gotham", appearance: "dark" },
  { id: "gruvbox-dark", name: "Gruvbox Dark", appearance: "dark" },
  { id: "gruvbox-light", name: "Gruvbox Light", appearance: "light" },
  { id: "gruvbox-material-dark", name: "Gruvbox Material Dark", appearance: "dark" },
  { id: "hacker-s-green", name: "Hacker's Green", appearance: "dark" },
  { id: "hot-iron", name: "Hot Iron", appearance: "dark" },
  { id: "hp-dev-one", name: "HP Dev One", appearance: "dark" },
  { id: "kanagawa", name: "Kanagawa", appearance: "dark" },
  { id: "nature", name: "Nature", appearance: "dark" },
  { id: "nord-dark", name: "Nord Dark", appearance: "dark" },
  { id: "nord-light", name: "Nord Light", appearance: "light" },
  { id: "nordic-dark", name: "Nordic Dark", appearance: "dark" },
  { id: "obsidian", name: "Obsidian", appearance: "dark" },
  { id: "ocean-dark", name: "Ocean Dark", appearance: "dark" },
  { id: "one-dark", name: "One Dark", appearance: "dark" },
  { id: "one-light", name: "One Light", appearance: "light" },
  { id: "pop-classic-dark", name: "Pop Classic Dark", appearance: "dark" },
  { id: "protest", name: "Protest", appearance: "dark" },
  { id: "rose-pine", name: "Rose Pine", appearance: "dark" },
  { id: "solarized-dark", name: "Solarized Dark", appearance: "dark" },
  { id: "solarized-light", name: "Solarized Light", appearance: "light" },
  { id: "spotify", name: "Spotify", appearance: "dark" },
  { id: "steam-classic", name: "Steam Classic", appearance: "dark" },
  { id: "stone", name: "Stone", appearance: "dark" },
  { id: "synthwave84", name: "Synthwave84", appearance: "dark" },
  { id: "system76-light", name: "System76 Light", appearance: "light" },
  { id: "tokyonight", name: "Tokyonight", appearance: "dark" },
  { id: "ubuntu-light", name: "Ubuntu Light", appearance: "light" },
  { id: "windows-95", name: "Windows 95", appearance: "light" },
] as const satisfies readonly { id: string; name: string; appearance: Appearance | null }[]

export type ThemeId = (typeof themes)[number]["id"]

export const THEME_IDS = themes.map((t) => t.id) as [ThemeId, ...ThemeId[]]

export function getDeclaredAppearance(id: ThemeId): Appearance | null {
  return themes.find((t) => t.id === id)?.appearance ?? null
}
