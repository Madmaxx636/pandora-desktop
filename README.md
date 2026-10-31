# Pandora Desktop

A clean desktop client for Pandora Radio on Linux and Windows, laid out like Spotify: stations in a sidebar, a station page with now playing, up next and history, and a player bar along the bottom.

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by Pandora or SiriusXM. It uses Pandora's unofficial web API, which can change or stop working at any time. You need your own Pandora account.

## Features

- Station list with **pinning**, a wide **search** that creates stations, and a **Tune station** page (rename, add or remove seed artists and songs, review and undo thumbs)
- Thumbs up / down, skip, seek, volume, media keys and the system now-playing widget
- **Background playback**: close to the taskbar or the tray, start minimized, launch at login
- Album-colour backdrop, accent colours, audio quality, history length and more in Settings
- **Automatic updates** from GitHub Releases

## Install

Download the latest build from [Releases](https://github.com/Madmaxx636/pandora-desktop/releases):

- **Linux:** `pandora-desktop_<version>_amd64.deb` (`sudo apt install ./pandora-desktop_*.deb`) or the `.AppImage`
- **Windows:** `Pandora-Setup-<version>.exe`. The installer isn't code-signed, so SmartScreen will warn: choose *More info → Run anyway*.

Accounts that sign in with Google, Apple or Facebook need a Pandora password set first.

## Develop

```bash
npm install
npm start
```

On Linux, if Electron reports the SUID sandbox helper is misconfigured:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Release

Bump `version` in `package.json`, commit, then tag and push:

```bash
git tag v1.0.1 && git push origin main v1.0.1
```

The *Release* workflow builds the Linux and Windows installers and publishes them, with the update metadata the app uses to update itself.

## License

MIT
