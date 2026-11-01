# BridgeView for iOS

An iPhone app for people near the Blue Water Bridge. Its main job is a push
notification about 5–10 minutes before a ship goes under the bridge, so there's
time to get to the river. With Live Activities on, the alert also puts a countdown
on the Lock Screen and in the Dynamic Island until the ship has passed.

It also lists the ships heading for the bridge ("Coming up") and those that went
under it in the last day ("Recent"). Each ship has a page with its photos (swiped round from the
last back to the first, and tapped to see them full screen with pinch to zoom;
`Views/PhotoPager.swift`) and details from Wikidata, a map, and links to VesselFinder, MarineTraffic and Wikipedia. "Add
photo" on a ship's page takes or picks a photo of it and sends it to the server
(`Views/SharePhotoView.swift`), where it waits for approval on the admin page; the
button shows only when the server takes them (`photoSharing` in `GET /api/bridge`). "Coming
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

- Xcode 26 or later (27.1 or later for full screen on iPhone Duo), iOS 18 or later
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

## iPhone Duo

The app runs on both of iPhone Duo's displays and turns sideways with the phone
(portrait and landscape, so it works stood open like a tent; the inner display
ignores supported orientations anyway). Layout follows size classes, never the
device or orientation: on the inner display (regular width) the tabs can become a
sidebar (`.sidebarAdaptable`), and lists, ship details and the map's ship card keep
to a readable width (`readableWidth()` in `Views/Styling.swift`). Build with Xcode
27.1 or later (the iOS 27.1 SDK) for edge to edge; with an earlier SDK it still runs
there, letterboxed. The release workflow uses the newest Xcode on its runner and
warns if that's older than 27.1. Try it in Xcode's iPhone Duo simulator, opening and
closing it from Device Hub.

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
├── scripts/               # testflight.js: build, sign and upload a release to TestFlight
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

## Releases

Merging a PR ships nothing to the App Store. A release is a GitHub release tagged
`ios-vX.Y.Z`; publishing it runs `.github/workflows/ios-release.yml`, which builds the app from
that tag on a GitHub-hosted Mac, uploads it to TestFlight with the release notes as **What to
Test**, and once Apple has processed it (5 to 15 minutes) adds it to the TestFlight groups named
in the `IOS_BETA_GROUP` variable (comma-separated). When any is external (a public beta) that also
submits it for Beta App Review; later builds of the same version usually pass at once. Submitting a version to
the App Store stays a step in App Store Connect.

A TestFlight build is a beta, so its release is a **prerelease** (`--prerelease`).

- **PRs never touch the version.** The marketing version comes from the tag (`ios-v1.1.0` builds
  1.1.0) and the build number is one more than the highest App Store Connect has. The numbers in
  `project.yml` are only what local builds show.
- **Cutting a release:**

  ```bash
  git log --oneline "$(git describe --tags --match 'ios-v*' --abbrev=0)"..origin/main -- ios Shared
  gh release create ios-v1.1.0 --prerelease --target main --title "iOS 1.1.0: <headline>" --notes-file notes.md
  ```

  The first command lists what changed in the app since the last release. Write the notes for
  testers: what's new and what to try, plain words, at most 4000 characters, **no emoji** (App
  Store Connect refuses them; the script stops before building if it finds any). Bump the minor
  version for features, the patch for fixes. Then watch **Actions → iOS release**.
- **Fixing the notes** on a build already up: edit the release, then run
  `node ios/scripts/testflight.js --version 1.1.0 --notes-file notes.md --notes-only` locally.
- **A dry run** (build and sign, no upload) is **Actions → iOS release → Run workflow**.
- **Locally**, `node ios/scripts/testflight.js --version 1.1.0 --notes-file notes.md` does what
  the workflow does, signed by Xcode's account and with your `Config/Local.xcconfig`.

Builds expire from TestFlight after 90 days.

### App settings for the workflow

The repo doesn't name the app's bundle ID, team or server; the workflow writes its
`Config/Local.xcconfig` from repository variables: `IOS_BUNDLE_ID`, `IOS_TEAM_ID` and
`IOS_API_URL` (e.g. `https://bridgeview.yourdomain.com`), plus `IOS_BETA_GROUP`, the TestFlight
groups each build goes to, separated by commas (optional; e.g. `Friends,Public beta`).

### The App Store Connect key

The workflow and the script use a team API key for build numbers, uploads, notes and groups.
An Admin creates it in App Store Connect → **Users and Access → Integrations → App Store
Connect API** (role App Manager).

- **For the workflow:** repository variables `ASC_KEY_ID` and `ASC_ISSUER_ID`, and the `.p8`
  contents as the secret `ASC_KEY_P8` of the app-release environment.
- **On your Mac:** the `.p8` at `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`, and
  `ASC_KEY_ID` / `ASC_ISSUER_ID` in your shell profile. `ASC_KEY_PATH` points the script at a
  key kept somewhere else. Never commit the key.

The release secrets belong to the **app-release** environment, not the repository: repository
secrets reach a workflow on any branch, so anyone who can push could sign a build. Set it up once
in Settings → Environments → app-release: required reviewers, and deployment branches and tags
limited to `main` and `ios-v*`. The workflow also refuses a commit that isn't on main.

### The CI signing certificate

The workflow signs with fixed files: an **Apple Distribution** certificate made for CI and two
App Store provisioning profiles, **BridgeView CI App Store** for the app and **BridgeView CI
Widgets** for `<bundle ID>.widgets`. They're secrets of the app-release environment:
`IOS_DIST_P12` (certificate and private key, base64), `IOS_DIST_P12_PASSWORD`,
`IOS_APPSTORE_PROFILE` and `IOS_WIDGETS_PROFILE` (each `.mobileprovision`, base64). Don't switch
the workflow to automatic signing with the API key: `xcodebuild` then creates a new development
certificate in the account on every run.

Both expire after a year. To make them (or renew them, or after adding a capability, which needs
new profiles):

1. Make a key and request, upload the request to developer.apple.com → Certificates → **+** →
   **Apple Distribution**, and download the `.cer` into the same folder as `distribution.cer`:

   ```bash
   mkdir -p ~/bridgeview-ci-signing && chmod 700 ~/bridgeview-ci-signing && cd ~/bridgeview-ci-signing && openssl req -new -newkey rsa:2048 -nodes -keyout ci.key -out ci.csr -subj "/CN=BridgeView CI" && chmod 600 ci.key
   ```

2. Profiles → **+** → **App Store Connect**, once for the app's ID (name it `BridgeView CI App
   Store`) and once for `<bundle ID>.widgets` (`BridgeView CI Widgets`), each with the new
   certificate. Download both into the same folder.
3. Store them (macOS's own `/usr/bin/openssl` makes a bundle the build machine's keychain can
   import):

   ```bash
   cd ~/bridgeview-ci-signing && export P12_PASS=$(openssl rand -hex 24) && openssl x509 -inform DER -in distribution.cer -out ci.pem && /usr/bin/openssl pkcs12 -export -inkey ci.key -in ci.pem -name "BridgeView CI" -out ci.p12 -passout env:P12_PASS && base64 -i ci.p12 | gh secret set IOS_DIST_P12 --env app-release && printf '%s' "$P12_PASS" | gh secret set IOS_DIST_P12_PASSWORD --env app-release && base64 -i BridgeView_CI_App_Store.mobileprovision | gh secret set IOS_APPSTORE_PROFILE --env app-release && base64 -i BridgeView_CI_Widgets.mobileprovision | gh secret set IOS_WIDGETS_PROFILE --env app-release; unset P12_PASS
   ```

4. Do a dry run (Actions → iOS release → Run workflow), revoke any old CI certificate, and
   delete `~/bridgeview-ci-signing`.

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
