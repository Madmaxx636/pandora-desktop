# Pandora Desktop

A clean desktop client for Pandora Radio on Linux and Windows, laid out like Spotify: stations in a sidebar, a station page with now playing, up next and history, and a player bar along the bottom.

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by Pandora or SiriusXM. It uses Pandora's unofficial web API, which can change or stop working at any time. You need your own Pandora account.

## Features

- Station list with **pinning**, a wide **search** that creates stations, **station deletion**, and a **Tune station** page (rename, add or remove seed artists, songs and genres, review and undo thumbs)
- Upcoming songs buffer ahead of time, and any song in History can be replayed or rated
- **Spell check** with suggestions in text fields, and an interface that scales down to small windows
- Thumbs up / down, skip, seek, volume, media keys and the system now-playing widget
- **Background playback**: close to the taskbar or the tray, start minimized, launch at login
- Album-colour backdrop, accent colours, audio quality, history length and more in Settings
- **Automatic updates** from GitHub Releases

## Install

Download the latest build from [Releases](https://github.com/Madmaxx636/pandora-desktop/releases):

- **Linux:** `pandora-desktop_<version>_amd64.deb` (`sudo apt install ./pandora-desktop_*.deb`) or the `.AppImage`
- **Windows:** `Pandora-Setup-<version>.exe`. The installer isn't code-signed, so SmartScreen will warn: choose *More info → Run anyway*.

On Linux the app only remembers your login if a keyring (KWallet, GNOME Keyring) is running; otherwise you sign in each launch.

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

## Test

```bash
npm test
```

Runs the Pandora client tests (encryption, error handling, playlist and search parsing) with Node's built-in runner. They also run in CI on every push.

## Release

Add the changes to `CHANGELOG.md`, run `npm version <x.y.z>` (it bumps `package.json` and tags), then push the commit and tag:

```bash
git push origin main --follow-tags
```

The *Release* workflow builds the Linux and Windows installers and publishes them, with the update metadata the app uses to update itself.

## License

MIT
