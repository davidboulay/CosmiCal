<h1 align="center">CosmiCal</h1>

<p align="center">
  <b>A native-feeling calendar for the COSMIC desktop.</b><br>
  Two-way sync with Google, iCloud, Outlook and CalDAV.
</p>

---

CosmiCal is a calendar app tailored for [COSMIC](https://system76.com/cosmic/) (Pop!\_OS), built on top of the excellent [rencal](https://github.com/t4t5/rencal) engine. It keeps rencal's fast CalDAV sync and adds COSMIC-focused touches on top.

## Features

- **COSMIC theming** — dark and light COSMIC palettes that match the desktop.
- **Two-way sync** — Google, iCloud, Outlook, CalDAV (via [caldir](https://github.com/t4t5/caldir)).
- **Show/hide & isolate calendars** — Google-Calendar-style calendar list in the sidebar, with per-account rename and color overrides.
- **Create, move & resize with the mouse** — click an empty slot for a 30-minute event, or drag to size it in 15-minute steps; drag an existing event to reschedule it, or drag its edge to resize. Backing out of a new event asks before discarding.
- **Move between calendars** — reassign an event to another calendar from the event details, even across different accounts.
- **Invitations & RSVP** — accept / decline / maybe pending invites from the sidebar or event details, applied instantly; recurring invites ask whether to respond to one occurrence or the whole series.
- **Google Meet** — add a Meet link when creating an event.
- **Multiple time zones** — show up to two extra zones in the week-view gutter and in event details, with custom labels and a live sidebar clock. Event times display in your local zone with the secondary-zone equivalents beneath.
- **Weather** — daily forecast in the week view via [Open-Meteo](https://open-meteo.com) (no API key required), with automatic or manual location; click a day's weather to open the full forecast.
- **Runs in the background** — closing the window keeps CosmiCal alive in the system tray so reminders and notifications keep working. Optionally start at login (and start minimized to the tray).
- **Live sync status** — see each account's sync progress individually, and configure how often CosmiCal checks for changes (Settings → General).
- **Self-updating** — checks GitHub Releases and installs the newer `.deb` in place from within the app.

## Install (Debian/Ubuntu/Pop!\_OS)

Download the `.deb` from the [latest release](https://github.com/davidboulay/CosmiCal/releases/latest) and install it:

```sh
sudo apt install ./CosmiCal_*_amd64.deb
```

An `.AppImage` and `.rpm` are also attached to each release.

### Updating

CosmiCal checks for new releases and can update itself: when one is available it offers to download and install the latest `.deb` (you'll be prompted for your password by PolicyKit), then relaunches automatically.

## Build from source

Requires Node 22, pnpm, Rust, and the usual Tauri Linux dependencies.

```sh
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # produce a release bundle
```

The turnkey Google sign-in uses a public OAuth client id and an OAuth proxy URL that are compiled in by default; both are non-secret and can be overridden at build time via the `COSMICAL_GOOGLE_CLIENT_ID` and `COSMICAL_OAUTH_PROXY_URL` environment variables. No client secret is ever baked into the binary.

## Credits & license

CosmiCal is a fork of [rencal](https://github.com/t4t5/rencal) by [@t4t5](https://github.com/t4t5), and uses [caldir](https://github.com/t4t5/caldir) for calendar sync. Huge thanks to the rencal project for the foundation.

Licensed under the [MIT License](./LICENSE) (© 2026 t4t5 and contributors), in keeping with the upstream project.
