package app.bridgeview

import app.bridgeview.model.AlertPreferences
import app.bridgeview.model.DeviceRegistration
import app.bridgeview.model.Direction
import app.bridgeview.model.ShipCategory
import app.bridgeview.net.ApiJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RegistrationTest {
    private val base = AlertPreferences(
        enabled = true,
        categories = setOf(ShipCategory.Cargo),
        minLength = 0,
        directions = setOf(Direction.Upbound),
    )

    @Test fun encodesTheAndroidRegistrationBody() {
        val preferences = AlertPreferences(
            enabled = true,
            categories = setOf(ShipCategory.Passenger, ShipCategory.Cargo, ShipCategory.Tanker),
            minLength = 100,
            directions = setOf(Direction.Downbound, Direction.Upbound),
        )
        val body = DeviceRegistration.from(preferences, countdownsAllowed = true)
        val json = ApiJson.encodeToString(DeviceRegistration.serializer(), body)
        assertEquals(
            """{"platform":"android","environment":"production","enabled":true,"liveActivities":true,""" +
                """"categories":["cargo","tanker","passenger"],"minLength":100,"directions":["upbound","downbound"]}""",
            json,
        )
        // Android never sends a push-to-start token (the server refuses one)
        assertFalse("pushToStartToken" in ApiJson.parseToJsonElement(json).jsonObject)
    }

    @Test fun holdsAlertsBackAwayFromTheBridge() {
        fun enabled(preferences: AlertPreferences, near: Boolean?) =
            DeviceRegistration.from(preferences, nearBridge = near, countdownsAllowed = false).enabled
        // Off: location doesn't matter
        assertTrue(enabled(base, false))
        val nearOnly = base.copy(nearBridgeOnly = true)
        assertTrue(enabled(nearOnly, true))
        assertFalse(enabled(nearOnly, false))
        // Location unknown: keep alerting rather than go quiet
        assertTrue(enabled(nearOnly, null))
        assertFalse(enabled(nearOnly.copy(enabled = false), true))
    }

    @Test fun turnsCountdownsOffWhenTheUserDoes() {
        assertTrue(DeviceRegistration.from(base, countdownsAllowed = true).liveActivities)
        assertFalse(DeviceRegistration.from(base, countdownsAllowed = false).liveActivities)
        assertFalse(DeviceRegistration.from(base.copy(liveActivities = false), countdownsAllowed = true).liveActivities)
    }

    @Test fun sendsPerShipChoicesOnlyWhenCountdownsAreAllowed() {
        fun ships(preferences: AlertPreferences, allowed: Boolean) =
            DeviceRegistration.from(preferences, countdownsAllowed = allowed).liveActivityShips
        assertNull(ships(base, true))
        val chosen = base.copy(liveActivityShips = mapOf(316001234 to true, 366999000 to false))
        assertEquals(mapOf("316001234" to true, "366999000" to false), ships(chosen, true))
        assertNull(ships(chosen, false))
        // The server refuses the whole registration for an MMSI that isn't 9 digits
        assertEquals(mapOf("316001234" to true), ships(base.copy(liveActivityShips = mapOf(3160012 to true, 316001234 to true)), true))
        assertNull(ships(base.copy(liveActivityShips = mapOf(3160012 to true)), true))
        // At most 50
        val many = (0 until 60).associate { 316_000_000 + it to true }
        assertEquals(50, ships(base.copy(liveActivityShips = many), true)?.size)
    }

    @Test fun storesPerShipChoicesAsText() {
        val ships = mapOf(366999000 to false, 316001234 to true)
        assertEquals("316001234:1,366999000:0", AlertPreferences.encodeShips(ships))
        assertEquals(ships, AlertPreferences.decodeShips("316001234:1,366999000:0,junk"))
        assertTrue(AlertPreferences.decodeShips("").isEmpty())
    }

    @Test fun storesSetsAsText() {
        assertEquals("cargo,tanker,passenger", AlertPreferences.encodeCategories(ShipCategory.defaultAlerts))
        assertEquals(setOf(ShipCategory.Tanker), AlertPreferences.decodeCategories("tanker,bogus"))
        assertEquals("upbound,downbound", AlertPreferences.encodeDirections(Direction.entries.toSet()))
        assertEquals(setOf(Direction.Downbound), AlertPreferences.decodeDirections("downbound"))
    }

    @Test fun defaultsMatchIos() {
        val defaults = AlertPreferences()
        assertTrue(defaults.enabled)
        assertEquals(setOf(ShipCategory.Cargo, ShipCategory.Tanker, ShipCategory.Passenger), defaults.categories)
        assertEquals(setOf(Direction.Upbound, Direction.Downbound), defaults.directions)
        assertEquals(0, defaults.minLength)
        assertTrue(defaults.liveActivities)
        assertFalse(defaults.nearBridgeOnly)
        assertEquals(5, defaults.nearBridgeRadius)
    }
}
