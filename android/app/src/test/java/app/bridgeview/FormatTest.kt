package app.bridgeview

import app.bridgeview.model.DeepLink
import app.bridgeview.photo.SharedPhoto
import app.bridgeview.ui.Format
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class FormatTest {
    @Test fun formatsFigures() {
        assertEquals("1.6 NM", Format.distance(1.6))
        assertEquals("12 NM", Format.distance(12.4))
        assertEquals("11.2 kn", Format.speed(11.2))
        assertEquals("now", Format.minutes(0.4))
        assertEquals("8 min", Format.minutes(8.4))
        assertEquals("1 h 5 min", Format.minutes(65.0))
        assertEquals("Thunder Bay", Format.place("THUNDER BAY"))
    }

    @Test fun countsDownLikeATimer() {
        val now = Instant.ofEpochSecond(1_000)
        assertEquals("8:23", Format.countdown(now, now.plusSeconds(8 * 60 + 23)))
        assertEquals("1:02:05", Format.countdown(now, now.plusSeconds(3600 + 125)))
        assertEquals("0:00", Format.countdown(now, now.minusSeconds(5)))
    }

    @Test fun readsDeepLinks() {
        assertEquals("bridgeview://ship/316001234", DeepLink.ship(316001234))
        assertEquals(316001234, DeepLink.mmsi("bridgeview", "ship", "316001234"))
        assertNull(DeepLink.mmsi("https", "ship", "316001234"))
        assertNull(DeepLink.mmsi("bridgeview", "other", "316001234"))
        assertNull(DeepLink.mmsi("bridgeview", "ship", "abc"))
    }

    @Test fun sizesSharedPhotos() {
        assertTrue(SharedPhoto.isBigEnough(640, 480))
        assertFalse(SharedPhoto.isBigEnough(639, 400))
        assertEquals(2048 to 1536, SharedPhoto.targetSize(4032, 3024))
        assertEquals(1536 to 2048, SharedPhoto.targetSize(3024, 4032))
        // Never enlarged
        assertEquals(1000 to 800, SharedPhoto.targetSize(1000, 800))
    }
}
