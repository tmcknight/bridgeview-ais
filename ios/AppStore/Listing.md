# App Store listing

Text and answers for App Store Connect. Screenshots are in `screenshots/` at the
large display size (1320×2868, iPhone 17 Pro Max) and in `screenshots/medium/` at the
medium display size (1206×2622, iPhone 17), scaled down from the large ones. App Store
Connect requires the medium set ("iPhone with Dynamic Island (medium display)" in its
Media Manager); the large set is optional.

## App information

| Field | Value |
| --- | --- |
| Name | BridgeView |
| Subtitle (30) | Ships at the Blue Water Bridge |
| Primary category | Travel |
| Secondary category | Reference |
| Age rating | 4+ (no objectionable content). The questionnaire's user-generated content question: yes, shared ship photos, all reviewed before they're shown |
| Price | Free |
| Privacy policy URL | `https://ships.utilityos.com/privacy.html` |
| Support URL | `https://ships.utilityos.com/support.html` |
| License agreement | Apple's standard EULA (terms of use: `https://ships.utilityos.com/terms.html`) |
| Marketing URL (optional) | `https://ships.utilityos.com/` |
| Copyright | 2026 Tom McKnight |

## Promotional text (170)

See every freighter heading for the Blue Water Bridge and get an alert about ten
minutes before one goes under, so there's time to get to the river.

## Description

BridgeView tells you when a ship is about to go under the Blue Water Bridge between
Port Huron and Sarnia, with enough time to get down to the river and watch it pass.

COMING UP
See the ships heading for the bridge in the next three hours, soonest first, with a
live countdown, how far out each one is, and which way it's going: upbound to Lake
Huron or downbound to Lake St. Clair.

ALERTS BEFORE IT PASSES
Get a notification about ten minutes before a ship reaches the bridge. With Live
Activities on, a countdown stays on your Lock Screen and in the Dynamic Island until
the ship goes under.

ONLY THE SHIPS YOU CARE ABOUT
Choose cargo ships, tankers or passenger ships, a minimum length, and which
directions. Turn on "Only when I'm near the bridge" and alerts pause while you're
away, and start again when you come back. Your location never leaves your phone.

EVERY SHIP'S STORY
Each ship has a page with its photo, where it's going, what it's likely carrying,
when it was built and who runs it, its recent trips under the bridge, a map, and
links to VesselFinder, MarineTraffic and Wikipedia.

SHARE YOUR PHOTOS
Caught a great shot of a laker under the bridge? Add it to the ship's page. Every
photo is checked before it appears, and you can be credited by name.

WATCH IT PASS
Jump to the Port Huron ship cam to watch the next ship go by live.

Also: the ships that went under the bridge in the last day, and Light and Dark
modes.

Ship positions come from AIS, the radio signals ships broadcast, received by a local
antenna and public data feeds. Arrival times are estimates from each ship's speed
and course. BridgeView is for watching ships, not for navigation.

Terms: https://ships.utilityos.com/terms.html

## Keywords (100)

```
freighter,laker,AIS,Port Huron,Sarnia,St. Clair River,Great Lakes,vessel,tracker,boatnerd,alert
```

(Words already in the name and subtitle, like "ship" and "bridge", are indexed from
there and don't need repeating.)

## What's new (first release)

First release.

## What's new (photo sharing)

Share your own photos of the ships. Tap Add photo on a ship's page to take one or
pick one from your library, and add your name to be credited. Every photo is checked
before it appears.

## Screenshots

In this order:

1. `1-coming-up.png`: Coming up, with the next ship's countdown
2. `2-next-ship.png`: the next ship's page: photo, countdown, map
3. `3-ship-details.png`: a ship's photo and details
4. `4-coming-up-dark.png`: Coming up in Dark mode
5. `5-passed.png`: ships that went under the bridge in the last day
6. `6-alert-settings.png`: alert settings

Taken in the simulator (iPhone 17 Pro Max) against the live server's ships,
photos and details. For 1, 2 and 4, four of the day's ships were given positions
and ETAs heading for the bridge, since none were on their way at the time. Worth
adding later: a Lock Screen shot of the Live Activity from a real device (the
simulator can't start one).

## App privacy (the "nutrition label")

**Data collection: Yes**:

| Data type | Used for | Linked to the user? | Used for tracking? |
| --- | --- | --- | --- |
| Identifiers → Device ID | App Functionality | Yes | No |
| User Content → Photos or Videos | App Functionality | Yes | No |
| Contact Info → Name | App Functionality | Yes | No |

Device ID covers the push notification and Live Activity tokens the server keeps to
send alerts, stored with the alert settings and no name, account or contact details,
and the random ID sent with shared photos so a sender can be banned. Photos and Name
are only collected when someone shares a photo of a ship (the name is optional, and
shown with the photo as its credit). Declare all three linked: a shared photo waiting
for approval is stored with the app's random ID and the name given, so the ID can be
tied to a name. Push tokens on their own are never stored with a name, but the
answer covers the whole data type.

**Not collected:**

- **Location.** The near-the-bridge check runs on the phone (a geofence); only
  "send alerts or not" reaches the server. Apple counts data processed only on the
  device as not collected.
- Other contact info, health, financial info, contacts, other user content, browsing
  or search history, purchases, usage data, diagnostics.

IP addresses seen by the server for rate limiting and in short-lived web server logs
don't need declaring when they're not kept or used beyond operating the service.

## Notes for App Review

> BridgeView alerts people near the Blue Water Bridge (Port Huron, Michigan) when a
> ship is about to go under it. Ship traffic depends on the shipping season and time
> of day, so the "Coming up" list may be short or empty; the "Passed" tab shows ships
> from the last 24 hours.
>
> Location is optional and only used if the user turns on "Only when I'm near the
> bridge" in Settings. It uses a geofence around the bridge (CLMonitor) so alerts
> pause while the user is away; that's why it asks for Always access. The location
> stays on the device; the app only sends the server whether to send alerts.
>
> No account or sign-in is needed.
>
> Users can share photos of ships from a ship's page ("Add photo"). Every photo is
> reviewed by us before anyone else sees it, so nothing objectionable is published;
> we can ban senders from sharing (by the app's random install ID and IP address).
> Any photo on a ship's page can be reported in the app (the "…" button on the
> photo, then "Report this photo"); reports come to us and we hide the photo. Anyone
> can also ask for a photo to be taken down at the contact address in the terms. The camera is used only when the user taps "Take a photo".

## Export compliance

`ITSAppUsesNonExemptEncryption` is already `false` in `project.yml` (the app only
uses HTTPS), so no export compliance questions come up on upload.
