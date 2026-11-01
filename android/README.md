# BridgeView for Android

The Android version of the [iOS app](../ios/README.md), with the same screens and
features, for people near the Blue Water Bridge. Its main job is an alert about 5–10
minutes before a ship goes under the bridge, so there's time to get to the river.
With live countdowns on (the Android counterpart of iOS Live Activities), the alert
becomes an ongoing notification counting down to the ship reaching the bridge, shown
on the lock screen and, on Android 16, as a Live Update chip in the status bar, until
the ship has passed.

It lists the ships heading for the bridge ("Coming up") and those that went under it
in the last day ("Recent"), shows every ship nearby on a live map (hulls drawn to
scale, dead-reckoned between polls and eased onto each new report, as on the web and
iOS maps), and has a page for each ship with its photos (swiped round from the last
back to the first; tap for full screen with pinch and double-tap to zoom), details from
Wikidata and the vessel registers, a map, past passages and links. "Add photo" takes or
picks a photo and sends it for approval; "Report this photo" flags one. "Coming up"
links to the Port Huron ship cam.

Same look as iOS: river blue, international-orange accents, ship names in wide hull
lettering (Roboto Flex at an expanded width, bundled under the OFL, see
`ROBOTO_FLEX_LICENSE.txt`), and a Light, Dark or System appearance under Settings.
Direction arrows follow the phone's compass. Alerts can be limited to when the phone is
near the bridge (2–25 km) with a geofence; the location stays on the phone, and the
server only sees `enabled` turn off and on.

The app reads everything from the BridgeView server; the server sends the alerts
through Firebase Cloud Messaging. See [../ios/API.md](../ios/API.md) (the "Android"
section) for registration and the FCM payloads.

## Feature map (iOS → Android)

| iOS | Android |
| --- | --- |
| Tab bar / sidebar (`.sidebarAdaptable`) | `NavigationSuiteScaffold`: bottom bar on phones, rail on foldables and tablets |
| Live Activity (Lock Screen, Dynamic Island) | Ongoing countdown notification, promoted to a Live Update on Android 16 (`push/ShipNotifications.kt`) |
| APNs alert | FCM data message turned into a high-priority notification |
| `CLMonitor` geofence | Play services geofence + one location fix for the starting state (`push/NearBridgeMonitor.kt`) |
| Keychain device ID | Random ID in preferences, carried by Android backup (`net/DeviceId.kt`) |
| `PhotosPicker` / camera | Photo picker / `TakePicture` with a `FileProvider` |
| MapKit | MapLibre with OpenFreeMap tiles (as on the web), ships drawn over it in Compose (`ui/ShipMap.kt`) |
| Background task + retries | WorkManager (`push/RegistrationWorker.kt`): retried with backoff, only when online |
| `bridgeview://ship/<mmsi>` | Same link, handled by `MainActivity` |

## Requirements

- JDK 17 or later (21 recommended), Android SDK with platform 37 (Android Studio, or
  `sdkmanager "platforms;android-37.0"`). Gradle comes from the wrapper.
- Runs on Android 10 (API 29) and later.
- For alerts: a Firebase project with Cloud Messaging (free).

## Setup

1. **Firebase.** In the [Firebase console](https://console.firebase.google.com), add a
   project and an Android app with your application ID (e.g. `com.yourname.bridgeview`).
   You don't need `google-services.json`: copy the values below from it, or from the
   app's settings page. Then, under Project settings → Service accounts, generate a
   private key: that JSON is the server's `FCM_SERVICE_ACCOUNT`.
2. **Local settings.** Copy `local.properties.example` to `local.properties` (untracked)
   and fill it in:

   ```properties
   sdk.dir=/path/to/Android/sdk
   bridgeview.applicationId=com.yourname.bridgeview
   bridgeview.apiUrl=https://bridgeview.yourdomain.com
   bridgeview.firebase.appId=1:1234567890:android:abcdef
   bridgeview.firebase.apiKey=AIza...
   bridgeview.firebase.projectId=your-project
   bridgeview.firebase.senderId=1234567890
   ```

   Each can also be a Gradle property (`-Pbridgeview.apiUrl=…`) or an environment
   variable (`BRIDGEVIEW_API_URL`, `BRIDGEVIEW_FIREBASE_APP_ID`, …). Without the Firebase
   settings the app works but gets no alerts, and Settings says so.
3. Open `android/` in Android Studio and run **app**, or `./gradlew :app:installDebug`.

Debug and release builds use the same FCM project; there's no sandbox as with APNs.

## Project layout

```
android/
├── app/src/main/java/app/bridgeview/
│   ├── BridgeViewApp.kt     # The app's shared objects (API client, store, push, location, compass)
│   ├── MainActivity.kt      # Polls while in front, opens bridgeview:// links and notification taps
│   ├── model/               # Ship, alert preferences and registration, motion, links
│   ├── net/                 # API client, error wording, date decoding, device ID
│   ├── data/                # Settings (same keys as iOS), bridge snapshot store, router
│   ├── push/                # FCM, notifications and live countdowns, registration worker, geofence
│   ├── photo/               # Getting a photo ready to share
│   ├── sensors/             # Compass for direction arrows
│   └── ui/                  # Compose screens: Coming up, Map, Recent, Settings, ship page, photos
├── app/src/test/            # JVM unit tests (ports of the iOS tests, plus API client tests)
└── store/                   # Play Store icon
```

## Tests

```bash
cd android
./gradlew :app:lintDebug :app:testDebugUnitTest
```

## Releases

Like iOS, merging a PR ships nothing. A release is a GitHub release tagged
`android-vX.Y.Z`; publishing it runs `.github/workflows/android-release.yml`, which builds a
signed app bundle from that tag and uploads it to Google Play's internal testing track (or
`ANDROID_PLAY_TRACK`), with the first 500 characters of the release notes as "What's new".
The version name comes from the tag and the version code is one more than the highest Play
has. Run the workflow by hand for a dry run (build and sign, no upload; the bundle is kept
as an artifact).

```bash
gh release create android-v1.0.0 --prerelease --target main --title "Android 1.0.0: <headline>" --notes-file notes.md
```

The first upload of a new app has to be done by hand in the Play Console (Play only lets the
API upload to an app that already has a bundle); after that the workflow takes over.

### Settings for the workflow

In the `app-release` environment (the same one the iOS release uses):

- **Variables:** `ANDROID_APPLICATION_ID`, `BRIDGEVIEW_API_URL`, `ANDROID_FIREBASE_APP_ID`,
  `ANDROID_FIREBASE_API_KEY`, `ANDROID_FIREBASE_PROJECT_ID`, `ANDROID_FIREBASE_SENDER_ID`,
  and optionally `ANDROID_PLAY_TRACK` (default `internal`).
- **Secrets:** `ANDROID_KEYSTORE_BASE64` (the upload key's keystore, `base64 -w0 upload.jks`, or `base64 -i upload.jks` on macOS),
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and
  `ANDROID_PLAY_SERVICE_ACCOUNT` (a Google Cloud service account's JSON key, invited in the
  Play Console under Users and permissions with permission to release to testing tracks).

Make an upload key once with
`keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 4096 -validity 10000 -alias upload`
and enrol in Play App Signing, so Google holds the app signing key.
