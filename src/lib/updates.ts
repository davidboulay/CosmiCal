// Update checking against the public GitHub releases API. CosmiCal is
// distributed as a .deb; installing a .deb silently requires sudo, which the
// app can't obtain — so the most we can do is detect a newer release and let
// the user download the asset / open the release page to install it manually.
import { getVersion } from "@tauri-apps/api/app"

const RELEASES_API = "https://api.github.com/repos/davidboulay/CosmiCal/releases/latest"
const RELEASES_PAGE = "https://github.com/davidboulay/CosmiCal/releases/latest"

export type UpdateInfo = {
  /** Current running app version (from Tauri / package.json). */
  currentVersion: string
  /** Latest version published on GitHub, e.g. "0.2.0". */
  latestVersion: string
  /** True when latestVersion is strictly newer than currentVersion. */
  hasUpdate: boolean
  /** Direct download URL for the .deb asset, when one exists. */
  debUrl: string | null
  /** Human-facing release page, used as a fallback / "view release" link. */
  releaseUrl: string
}

// Strip a leading "v" and split into numeric components for comparison.
function parseVersion(tag: string): number[] {
  return tag
    .trim()
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n))
}

/** Returns true when `a` is strictly newer than `b` (semver-ish, numeric). */
export function isNewer(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

type GitHubAsset = { name?: string; browser_download_url?: string }
type GitHubRelease = {
  tag_name?: string
  html_url?: string
  assets?: GitHubAsset[]
}

// Query the latest release and compare it to the running version. Throws on
// network / API failure so callers can surface an error state.
export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = await getVersion()

  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  })
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
  const release = (await res.json()) as GitHubRelease

  const latestVersion = (release.tag_name ?? "").replace(/^v/i, "")
  const releaseUrl = release.html_url || RELEASES_PAGE
  const deb = release.assets?.find((a) => a.name?.toLowerCase().endsWith(".deb"))
  const debUrl = deb?.browser_download_url ?? null

  return {
    currentVersion,
    latestVersion: latestVersion || currentVersion,
    hasUpdate: latestVersion ? isNewer(latestVersion, currentVersion) : false,
    debUrl,
    releaseUrl,
  }
}
