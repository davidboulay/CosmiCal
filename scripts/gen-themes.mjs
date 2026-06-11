import fs from "node:fs"
import path from "node:path"

const SRC = "/home/davidboulay/Claude/cosmic-calendar/Themes"
const OUT_CSS = "/home/davidboulay/Claude/rencal/src/themes/cosmic-generated.css"
const OUT_MANIFEST = "/home/davidboulay/Claude/rencal/src/themes/manifest.ts"

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
const toHex = (r, g, b) =>
  "#" +
  [r, g, b]
    .map((c) =>
      clamp(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
const lumaHex = (hex) => {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
const hexRgb = (hex) => {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const blend = (hex, target, t) => {
  const [r, g, b] = hexRgb(hex)
  const m = (c) => clamp(c + (target - c) * t)
  return "#" + [m(r), m(g), m(b)].map((c) => c.toString(16).padStart(2, "0")).join("")
}

// Pull `key: Some((red:..,green:..,blue:..[,alpha:..]))` (flat, no nested parens).
function color(text, key, withSome = true) {
  const inner = withSome ? "Some\\(\\(([^)]*)\\)" : "\\(([^)]*)\\)"
  const re = new RegExp(`(?:^|[,({\\s])${key}\\s*:\\s*${inner}`)
  const m = text.match(re)
  if (!m) return null
  const get = (c) => {
    const mm = m[1].match(new RegExp(`${c}\\s*:\\s*([0-9.]+)`))
    return mm ? parseFloat(mm[1]) : null
  }
  const r = get("red"),
    g = get("green"),
    b = get("blue")
  if (r == null || g == null || b == null) return null
  return toHex(r, g, b)
}

function nameFromFile(file) {
  let n = file
    .replace(/\.ron$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!/[A-Z]/.test(n)) n = n.replace(/\b\w/g, (c) => c.toUpperCase())
  return n
}
const slugify = (n) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

const files = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith(".ron"))
  .filter((f) => !/\(\d+\)\.ron$/.test(f)) // drop "X (1).ron" duplicates
  .sort((a, b) => a.localeCompare(b))

const entries = []
const seen = new Set()
const cssBlocks = []

for (const file of files) {
  const text = fs.readFileSync(path.join(SRC, file), "utf8")

  const bg = color(text, "bg_color") || color(text, "neutral_0", false) || "#1b1b1d"
  const appearance = lumaHex(bg) > 0.5 ? "light" : "dark"
  const isDark = appearance === "dark"

  const accent =
    color(text, "accent") || color(text, "accent_blue", false) || (isDark ? "#62a0ea" : "#9a3e3e")
  const success = color(text, "success") || (isDark ? "#5ec264" : "#2e7d32")
  const warning = color(text, "warning") || (isDark ? "#e6a23c" : "#b26a00")
  const error = color(text, "destructive") || (isDark ? "#e25252" : "#c0392b")
  const highlight = color(text, "accent_purple", false) || accent

  const fg = blend(bg, isDark ? 255 : 0, 0.88)
  const [fr, fg2, fb] = hexRgb(fg)
  const muted = `rgba(${fr}, ${fg2}, ${fb}, 0.55)`
  const divider = blend(bg, isDark ? 255 : 0, 0.14)
  const border = blend(bg, isDark ? 255 : 0, 0.22)
  const primaryFg = lumaHex(accent) > 0.55 ? "#16161a" : "#f7f7f7"
  const hoverTint = isDark ? "#c7cad6" : "#5a4a42"

  let id = slugify(nameFromFile(file))
  if (!id) id = "theme"
  let unique = id,
    i = 2
  while (seen.has(unique)) unique = `${id}-${i++}`
  id = unique
  seen.add(id)
  const name = nameFromFile(file)

  entries.push({ id, name, appearance, bg })

  cssBlocks.push(`/* ${name} — generated from COSMIC theme "${file}" */
[data-theme="${id}"] {
  --font-heading: var(--sans);
  --font-button: var(--sans);
  --font-numerical: var(--sans);
  --font-heading-transform: normal;
  --font-button-transform: normal;
  --font-numerical-transform: normal;
  --radius-base: 0.75rem;
  --radius-circle: calc(infinity * 1px);
  --control-height: 36px;

  --background: ${bg};
  --foreground: ${fg};
  --muted: ${muted};

  --primary: ${accent};
  --primary-foreground: ${primaryFg};

  --today: ${accent};
  --highlight: ${highlight};

  --success: ${success};
  --warning: ${warning};
  --error: ${error};

  --hover-tint: ${hoverTint};
  --hover-mix: 8%;

  --divider: ${divider};
  --border-button: ${border};

  --tab-gap: 4px;
  --tab-list-shadow: none;
}`)
}

// --- write generated CSS ---
fs.writeFileSync(
  OUT_CSS,
  `/* AUTO-GENERATED from COSMIC .ron themes by scripts/gen-themes — do not edit by hand. */\n\n${cssBlocks.join("\n\n")}\n`,
)

// --- write manifest.ts (COSMIC Light first, then generated) ---
const manifestRows = [
  `  { id: "cosmic-light", name: "COSMIC Light", appearance: "light" },`,
  ...entries.map(
    (e) => `  { id: "${e.id}", name: ${JSON.stringify(e.name)}, appearance: "${e.appearance}" },`,
  ),
].join("\n")

fs.writeFileSync(
  OUT_MANIFEST,
  `export type Appearance = "light" | "dark"

// \`appearance: null\` means the theme's appearance is derived at runtime.
// COSMIC palette themes below are auto-generated from .ron files; see
// src/themes/cosmic-generated.css and scripts/gen-themes.mjs.
export const themes = [
${manifestRows}
] as const satisfies readonly { id: string; name: string; appearance: Appearance | null }[]

export type ThemeId = (typeof themes)[number]["id"]

export const THEME_IDS = themes.map((t) => t.id) as [ThemeId, ...ThemeId[]]

export function getDeclaredAppearance(id: ThemeId): Appearance | null {
  return themes.find((t) => t.id === id)?.appearance ?? null
}
`,
)

// --- emit flash-prevention rules + global.css import for me to wire in ---
const flash = [{ id: "cosmic-light", bg: "#E3D5C5" }, ...entries]
  .map(
    (e) =>
      `      body[data-theme="${e.id}"],\n      body:not([data-theme])[data-default-theme="${e.id}"] {\n        background-color: ${e.bg};\n      }`,
  )
  .join("\n")
fs.writeFileSync("/tmp/flash-rules.html", flash)

console.log(`Generated ${entries.length} themes (+ cosmic-light).`)
console.log(
  "First 6:",
  entries
    .slice(0, 6)
    .map((e) => `${e.id} (${e.appearance})`)
    .join(", "),
)
console.log("Flash rules written to /tmp/flash-rules.html")
