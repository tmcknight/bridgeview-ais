# BridgeView for iOS

An iPhone app for people near the Blue Water Bridge. Its main job is a push
notification about 5–10 minutes before a ship goes under the bridge, so there's
time to get to the river. With Live Activities on, the alert also puts a countdown
on the Lock Screen and in the Dynamic Island until the ship has passed.

It also lists the ships heading for the bridge ("Coming up") and those that went
under it in the last day ("Passed"). Each ship has a page with its photo and details
from Wikidata, a map, and links to VesselFinder, MarineTraffic and Wikipedia. "Coming
up" links to the Port Huron ship cam, to watch the next ship go under the bridge.

It has its own look (river blue, international-orange accents, ship names in wide
hull lettering; colours and type in `Shared/Theme.swift`, shared with the Live
Activity) and a Light, Dark or System appearance setting under Settings. Direction
arrows point along each ship's AIS heading (or course) when its position is known.

Alerts can be limited to when the phone is near the bridge (2–25 km). The app
watches a geofence around the bridge (`Push/NearBridgeMonitor.swift`, CLMonitor;
needs Always location access) and turns the device's `enabled` off while it's
away; the location stays on the phone. Without Always access alerts aren't held back.

The app reads everything from the BridgeView server (`server/server.js`); the server
sends the alerts. See [API.md](API.md) for the endpoints and push payloads.

## Requirements

- Xcode 26 or later, iOS 18 or later
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) if you change `project.yml`
  (`brew install xcodegen`)
- For real pushes: an Apple Developer Program membership

## Setup

1. **App ID.** On [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list),
   register an App ID (e.g. `com.yourname.bridgeview`) with **Push Notifications**
   enabled, and under Push Notifications turn on **Broadcast** (needed for Live
   Activity updates on a channel; it can't be turned on from Xcode). Xcode creates
   the widget's App ID (`<id>.widgets`) itself.
2. **APNs key.** Under Keys, create a key with Apple Push Notifications service
   (APNs) and download the `.p8`. The server needs it with its key ID and your team
   ID (see the main README's push settings).
3. **Local settings.** Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`
   (untracked) and set your bundle ID, team ID and server URL:

   ```
   BRIDGEVIEW_BUNDLE_ID = com.yourname.bridgeview
   DEVELOPMENT_TEAM = ABCDE12345
   BRIDGEVIEW_API_URL = https:/$()/bridgeview.yourdomain.com
   ```

   (`//` starts a comment in an xcconfig, hence `$()`.) The server must use the same
   bundle ID as its APNs topic.
4. Open `BridgeView.xcodeproj` and run the **BridgeView** scheme.

Debug builds get APNs **sandbox** device tokens and say so when they register;
Release builds (TestFlight, App Store) get **production** ones. The server keeps
track of which is which.

The app icon (`BridgeView/Resources/Assets.xcassets/AppIcon.appiconset`) has
default, dark and tinted 1024×1024 versions. The launch screen shows the logo on river blue,
and the Live Activity uses the white logo (`LogoMark` in the widget's assets); the
full-size artwork is in `Brand/`.

## Project layout

```
ios/
├── project.yml            # XcodeGen spec; BridgeView.xcodeproj is generated from it
├── Config/                # xcconfigs: bundle ID, team, server URL, APNs environment
├── Shared/                # ShipApproachAttributes (Live Activity) and deep links, in both targets
├── BridgeView/            # The app
│   ├── Models/            # Ship, alert preferences, device registration, ship links
│   ├── Networking/        # API client, config from Info.plist, date decoding
│   ├── Push/              # App delegate, push registration, deep-link router
│   └── Views/             # Coming up, Passed, ship page, settings
├── BridgeViewWidgets/     # Live Activity (Lock Screen and Dynamic Island)
├── AppStore/              # Store listing text, privacy answers, review notes, screenshots
├── Brand/                 # Source artwork: icon (default, dark, tinted) and transparent logos
├── BridgeViewTests/       # Swift Testing unit tests
└── Samples/               # Sample push payloads for the simulator
```

After changing `project.yml`, regenerate the project with `xcodegen generate` (run in
`ios/`) and commit both.

## Tests

```bash
cd ios
xcodebuild -project BridgeView.xcodeproj -scheme BridgeView \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO test
```

## Trying a push in the simulator

Run the app in the simulator once and allow notifications, then:

```bash
xcrun simctl push booted com.example.bridgeview ios/Samples/bridge-alert.apns
```

Use your own bundle ID if you set one (also change `Simulator Target Bundle` in the
file). Tapping the notification opens that ship's page.

A Live Activity can't be started by `simctl push`; send a push-to-start payload
through the [Push Notifications Console](https://icloud.developer.apple.com/dashboard/notifications)
with the push-to-start token the app logs (subsystem `BridgeView`, category `push`),
or let the server send one.

## How alerts reach the phone

1. On launch the app asks for notification permission and registers with APNs.
2. It sends its device token, its Live Activity push-to-start token, whether Live
   Activities are on, and the alert settings to `PUT /api/devices/:token`. It sends
   them again whenever any of them changes.
3. When a matching ship is about 5–10 minutes out, the server sends either a
   push-to-start for a `ShipApproachAttributes` Live Activity (when Live Activities
   are on) or a normal notification, then updates and ends the Live Activity on a
   broadcast channel for that passage.
