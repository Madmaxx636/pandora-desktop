# Changelog

All notable changes to Pandora Desktop. Each release's notes on GitHub repeat its entry here, with SHA-256 checksums for the installers.

## 1.0.9 - 2026-11-02

- Tune station now lists Artists, Songs and Genres in separate sections, each with a count. The Genres section only appears once the station has one.
- Changes show up straight away: an added artist, song or genre appears immediately as "Adding...", then settles into place with a brief highlight. Removing a seed or a thumbs rating also takes effect on screen at once, and comes back with an error message if Pandora refuses.
- The page no longer reloads the whole list after each change, and reopening a station shows its last-known list instantly while it quietly refreshes.
- Search results in the Add variety box are grouped under Artists, Songs and Genres.

## 1.0.8 - 2026-11-01

- Fixed the interface looking far too big on a full screen: Auto scale no longer enlarges anything. It only shrinks the interface for windows smaller than the default size. (The 115% and 130% options in Settings are still there if you want it bigger.)
- Settings now sits in a centred column instead of hugging the left edge.

## 1.0.7 - 2026-11-01

- The whole interface now scales to the window. Auto mode shrinks it in a small window and enlarges it on a full screen, and Settings → Appearance → Interface scale lets you pick a fixed size instead.
- In a small corner window the sidebar becomes a slim icon strip and the player bar tightens up. Windows that are short get tighter spacing and a smaller song artwork.
- The window can now be made much smaller (down to 380 × 300).

## 1.0.6 - 2026-10-31

- Up next and History are stacked in one column instead of side by side.
- Up next shows 5 songs; History shows the 5 most recent, with older ones behind "Show more".

## 1.0.5 - 2026-10-31

- Added a play-again button on History rows (double-click works too). If Pandora's stream link for an old song has expired, the app says so and carries on with the station.

## 1.0.4 - 2026-10-31

- The station page reflows to fit the width of the window, including when you resize the sidebar.
- Smaller minimum window size, and the player bar tightens on narrow windows.

## 1.0.3 - 2026-10-31

- Upcoming songs start downloading as soon as they're queued, so skipping doesn't wait on the network.
- The sidebar can be dragged wider or narrower; double-click the handle to reset it.

## 1.0.2 - 2026-10-31

- Thumbs up and down on upcoming and previously played songs, not only the current one. Rating again removes the rating; a song thumbed down before it plays is dropped from the queue.

## 1.0.1 - 2026-10-31

- Fixed the Linux menu category so the app appears under Sound & Video.
- New app icon.

## 1.0.0 - 2026-10-31

- First release: station list with pinning, search, station tuning, thumbs, background playback with a tray icon, settings, and automatic updates from GitHub.
