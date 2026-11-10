package app.bridgeview

import app.bridgeview.model.LengthSetting
import app.bridgeview.model.LengthUnit
import app.bridgeview.model.NearBridgeRadius
import app.bridgeview.model.Lengths
import org.junit.Assert.assertEquals
import org.junit.Test

class LengthsTest {
    private val metres = Lengths(LengthUnit.Metres, "metres")
    private val meters = Lengths(LengthUnit.Metres, "meters")
    private val feet = Lengths(LengthUnit.Feet, "metres")

    @Test fun resolvesAutomaticFromTheMeasurementSystem() {
        assertEquals(LengthUnit.Feet, LengthSetting.Automatic.resolve(usesUsMeasurement = true))
        assertEquals(LengthUnit.Metres, LengthSetting.Automatic.resolve(usesUsMeasurement = false))
        // A choice made by hand wins over the region
        assertEquals(LengthUnit.Metres, LengthSetting.Metres.resolve(usesUsMeasurement = true))
        assertEquals(LengthUnit.Feet, LengthSetting.Feet.resolve(usesUsMeasurement = false))
    }

    @Test fun readsTheStoredSetting() {
        assertEquals(LengthSetting.Automatic, LengthSetting.fromRaw("auto"))
        assertEquals(LengthSetting.Metres, LengthSetting.fromRaw("m"))
        assertEquals(LengthSetting.Feet, LengthSetting.fromRaw("ft"))
        assertEquals(LengthSetting.Automatic, LengthSetting.fromRaw(null))
        assertEquals(LengthSetting.Automatic, LengthSetting.fromRaw("yards"))
    }

    @Test fun formatsLengths() {
        assertEquals("225 m", metres.length(225))
        assertEquals("738 ft", feet.length(225))
        assertEquals("1,014 ft", feet.length(309))
        assertEquals("Cargo · 225 m", metres.summary("Cargo", 225))
        assertEquals("Cargo · 738 ft", feet.summary("Cargo", 225))
        assertEquals("Cargo", feet.summary("Cargo", null))
        assertEquals("", feet.summary(null, null))
    }

    @Test fun formatsSizeAndDraught() {
        assertEquals("225 × 24 m", metres.size(225, 24))
        assertEquals("225 m long", metres.size(225, null))
        assertEquals("738 × 79 ft", feet.size(225, 24))
        assertEquals("738 ft long", feet.size(225, null))
        assertEquals("7.9 m", metres.draught(7.9))
        assertEquals("26 ft", feet.draught(7.9))
    }

    @Test fun spellsOutLengthsForScreenReaders() {
        assertEquals("225 metres", metres.spokenLength(225))
        assertEquals("225 meters", meters.spokenLength(225))
        assertEquals("738 feet", feet.spokenLength(225))
        assertEquals("Cargo, 225 metres", metres.spokenSummary("Cargo", 225))
        assertEquals("225 by 24 meters", meters.spokenSize(225, 24))
        assertEquals("738 feet long", feet.spokenSize(225, null))
        assertEquals("7.9 metres", metres.spokenDraught(7.9))
        assertEquals("26 feet", feet.spokenDraught(7.9))
    }

    @Test fun roundsTheAlertMinimumToTensOfFeet() {
        assertEquals("100 m", metres.minimum(100))
        assertEquals("330 ft", feet.minimum(100))
        assertEquals("490 ft", feet.minimum(150))
        assertEquals("660 ft", feet.minimum(200))
    }

    @Test fun picksAScaleBarStep() {
        assertEquals(500.0 to "500 m", metres.scaleStep(700.0))
        assertEquals(2000.0 to "2 km", metres.scaleStep(2500.0))
        assertEquals(50.0 to "50 m", metres.scaleStep(10.0))
        assertEquals("1,000 ft", feet.scaleStep(400.0).second)
        assertEquals("1 mi", feet.scaleStep(2000.0).second)
        assertEquals("100 ft", feet.scaleStep(1.0).second)
    }

    @Test fun offersNearBridgeDistancesInTheUnitSystem() {
        assertEquals(listOf(1_609, 4_828, 8_047, 24_140), NearBridgeRadius.usOptions)
        assertEquals(4_828, NearBridgeRadius.nearest(5_000, LengthUnit.Feet))
        assertEquals(5_000, NearBridgeRadius.nearest(4_828, LengthUnit.Metres))
        assertEquals(24_140, NearBridgeRadius.nearest(25_000, LengthUnit.Feet))
        assertEquals("5 km", NearBridgeRadius.label(5_000, LengthUnit.Metres))
        assertEquals("3 mi", NearBridgeRadius.label(4_828, LengthUnit.Feet))
    }
}
