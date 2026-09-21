# AT Progress Tracker

*(中文说明见 [README.zh.md](README.zh.md))*

A static site for tracking your progress on the Appalachian Trail: log the sections you've hiked, watch them fill in on the map, and see how each state is coming along. No account, no server -- everything stays in your browser.

## What it does

- The full AT on a map, with real mileage from the official trail data.
- Log a hike by date and a start/end point -- type a mile number or a place name.
- Overlapping or repeated hikes are never double-counted.
- Total miles, percent complete, days hiked, and progress broken down by state.
- Export/import your log as a JSON file, to back it up or move between devices.
- English and Chinese, miles and kilometers -- switch either from the top of the page.

## Roadmap

This is 1.0: the Appalachian Trail, done. Beyond it:

- **2.0** -- more long trails (PCT next), and an overview across all of them.
- **3.0** -- import your own GPX tracks instead of typing in mile ranges by hand.
- **4.0** -- a native iOS/iPadOS/macOS app.

The full plan, and the reasoning behind decisions already made, is in [PROJECT_PLAN.md](PROJECT_PLAN.md).

## Using it

Double-click [`start.command`](start.command) -- it starts a local server and opens the app in your browser. The first time, macOS will warn that it's from an unidentified developer; go to System Settings → Privacy & Security and click "Open Anyway".

The map needs a free Mapbox token. The page asks for one the first time you open it -- get one at [account.mapbox.com](https://account.mapbox.com) and paste it in. It's remembered in that browser only.

Your hike log is saved in your browser. Use "Export JSON" before switching devices or browsers, and "Import JSON" to bring an exported log back in.

## Running your own copy

It's a static site with no build step -- fork the repo, push to GitHub, and turn on Pages in the repo settings. For the data pipeline, file layout, data format, and licensing, see [SPEC.md](SPEC.md).

## License

Code is [MIT licensed](LICENSE). The trail data comes from other sources with their own licenses -- see [SPEC.md](SPEC.md).
