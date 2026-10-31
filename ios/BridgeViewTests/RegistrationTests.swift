import Foundation
import Testing
@testable import BridgeView

struct RegistrationTests {
    @Test func encodesRegistrationBody() throws {
        let preferences = AlertPreferences(
            enabled: true,
            categories: [.passenger, .cargo, .tanker],
            minLength: 100,
            directions: [.downbound, .upbound]
        )
        let body = DeviceRegistration(
            environment: "production",
            preferences: preferences,
            pushToStartToken: "80f7",
            liveActivities: true
        )
        let json = String(decoding: try JSONEncoder.api.encode(body), as: UTF8.self)
        #expect(json == #"{"categories":["cargo","tanker","passenger"],"directions":["upbound","downbound"],"enabled":true,"environment":"production","liveActivities":true,"minLength":100,"pushToStartToken":"80f7"}"#)
    }

    @Test func omitsMissingPushToStartToken() throws {
        let body = DeviceRegistration(
            environment: "sandbox",
            preferences: AlertPreferences(enabled: false, categories: [], minLength: 0, directions: []),
            pushToStartToken: nil,
            liveActivities: false
        )
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api.encode(body)) as? [String: Any])
        #expect(object["pushToStartToken"] == nil)
        #expect(object["enabled"] as? Bool == false)
    }

    @Test func holdsAlertsBackAwayFromTheBridge() {
        var preferences = AlertPreferences(enabled: true, categories: [.cargo], minLength: 0, directions: [.upbound])
        func enabled(near: Bool?) -> Bool {
            DeviceRegistration(
                environment: "sandbox", preferences: preferences, nearBridge: near,
                pushToStartToken: nil, liveActivities: false
            ).enabled
        }
        // Off: location doesn't matter
        #expect(enabled(near: false))
        preferences.nearBridgeOnly = true
        #expect(enabled(near: true))
        #expect(!enabled(near: false))
        // Location unknown: keep alerting rather than go quiet
        #expect(enabled(near: nil))
        preferences.enabled = false
        #expect(!enabled(near: true))
    }

    @Test func turnsLiveActivitiesOffWhenTheUserDoes() {
        var preferences = AlertPreferences(enabled: true, categories: [.cargo], minLength: 0, directions: [.upbound])
        func liveActivities(allowed: Bool) -> Bool {
            DeviceRegistration(
                environment: "sandbox", preferences: preferences,
                pushToStartToken: nil, liveActivities: allowed
            ).liveActivities
        }
        #expect(liveActivities(allowed: true))
        #expect(!liveActivities(allowed: false))
        preferences.liveActivities = false
        #expect(!liveActivities(allowed: true))
    }

    @Test func sendsPerShipChoicesOnlyWhenLiveActivitiesAreAllowed() throws {
        var preferences = AlertPreferences(enabled: true, categories: [.cargo], minLength: 0, directions: [.upbound])
        func ships(allowed: Bool) -> [String: Bool]? {
            DeviceRegistration(
                environment: "sandbox", preferences: preferences,
                pushToStartToken: nil, liveActivities: allowed
            ).liveActivityShips
        }
        #expect(ships(allowed: true) == nil)
        preferences.liveActivityShips = [316001234: true, 366999000: false]
        #expect(ships(allowed: true) == ["316001234": true, "366999000": false])
        #expect(ships(allowed: false) == nil)
    }

    @Test func storesPerShipChoicesAsText() {
        let ships = [366999000: false, 316001234: true]
        #expect(AlertPreferences.encodeShips(ships) == "316001234:1,366999000:0")
        #expect(AlertPreferences.decodeShips("316001234:1,366999000:0,junk") == ships)
        #expect(AlertPreferences.decodeShips("").isEmpty)
    }

    @Test func loadsDefaultPreferences() throws {
        let defaults = try #require(UserDefaults(suiteName: "RegistrationTests-\(UUID())"))
        let preferences = AlertPreferences.load(from: defaults)
        #expect(preferences.enabled)
        #expect(preferences.categories == [.cargo, .tanker, .passenger])
        #expect(preferences.directions == [.upbound, .downbound])
        #expect(preferences.minLength == 0)
        #expect(preferences.liveActivities)
        #expect(!preferences.nearBridgeOnly)
        #expect(preferences.nearBridgeRadius == 5)

        defaults.set("tanker,bogus", forKey: AlertPreferences.Key.categories)
        #expect(AlertPreferences.load(from: defaults).categories == [.tanker])
    }

    @Test func hexEncodesTokens() {
        #expect(Data([0x00, 0xab, 0x10]).hexString == "00ab10")
    }
}
