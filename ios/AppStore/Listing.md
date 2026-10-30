# App Store listing

Text and answers for App Store Connect. Screenshots for the 6.9" iPhone size
(1320×2868, iPhone 17 Pro Max) are in `screenshots/`; App Store Connect scales them
for smaller iPhones.

## App information

| Field | Value |
| --- | --- |
| Name | BridgeView |
| Subtitle (30) | Ships at the Blue Water Bridge |
| Primary category | Navigation |
| Secondary category | Travel |
| Age rating | 4+ (no objectionable content) |
| Price | Free |
| Privacy policy URL | `https://<your site>/privacy.html` |
| Support URL | `https://<your site>/support.html` |
| Marketing URL (optional) | `https://<your site>/` |
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

WATCH IT PASS
Jump to the Port Huron ship cam to watch the next ship go by live.

Also: the ships that went under the bridge in the last day, and Light and Dark
modes.

Ship positions come from AIS, the radio signals ships broadcast, received by a local
antenna and public data feeds. Arrival times are estimates from each ship's speed
and course.

## Keywords (100)

```
freighter,laker,AIS,Port Huron,Sarnia,St. Clair River,Great Lakes,vessel,tracker,boatnerd,alert
```

(Words already in the name and subtitle, like "ship" and "bridge", are indexed from
there and don't need repeating.)

## What's new (first release)

First release.

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

**Data collection: Yes**, one type:

| Data type | Used for | Linked to the user? | Used for tracking? |
| --- | --- | --- | --- |
| Identifiers → Device ID | App Functionality | No | No |

That covers the push notification and Live Activity tokens the server keeps to send
alerts, stored with the alert settings and no name, account or contact details.

**Not collected:**

- **Location.** The near-the-bridge check runs on the phone (a geofence); only
  "send alerts or not" reaches the server. Apple counts data processed only on the
  device as not collected.
- Contact info, health, financial info, contacts, user content, browsing or search
  history, purchases, usage data, diagnostics.

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

## Export compliance

`ITSAppUsesNonExemptEncryption` is already `false` in `project.yml` (the app only
uses HTTPS), so no export compliance questions come up on upload.
