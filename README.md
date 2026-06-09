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
- **Show/hide calendars** — Google-Calendar-style calendar list in the sidebar.
- **Click & drag to create** — click an empty slot for a 30-minute event, or drag to size it in 15-minute steps.
- **Multiple time zones** — show up to two extra zones in the week-view gutter and in event details, with custom labels and a live sidebar clock.
- **Weather** — daily forecast in the week view via [Open-Meteo](https://open-meteo.com) (no API key required), with automatic or manual location.
- **Invitations** — accept / decline / maybe pending invites from the sidebar.

## Install (Debian/Ubuntu/Pop!\_OS)

Download the `.deb` from the [latest release](https://github.com/davidboulay/CosmiCal/releases) and install it:

```sh
sudo apt install ./CosmiCal_*_amd64.deb
```

## Build from source

Requires Node 22, pnpm, Rust, and the usual Tauri Linux dependencies.

```sh
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # produce a release bundle
```

## Credits & license

CosmiCal is a fork of [rencal](https://github.com/t4t5/rencal) by [@t4t5](https://github.com/t4t5), and uses [caldir](https://github.com/t4t5/caldir) for calendar sync. Huge thanks to the rencal project for the foundation.

Licensed under the [MIT License](./LICENSE) (© 2026 t4t5 and contributors), in keeping with the upstream project.
