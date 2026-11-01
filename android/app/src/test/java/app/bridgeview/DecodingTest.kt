package app.bridgeview

import app.bridgeview.model.BridgeSnapshot
import app.bridgeview.model.Direction
import app.bridgeview.model.Passage
import app.bridgeview.model.Ship
import app.bridgeview.model.ShipCategory
import app.bridgeview.model.ShipLinks
import app.bridgeview.model.Attribution
import app.bridgeview.net.ApiJson
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class DecodingTest {
    @Test fun decodesBridgeSnapshot() {
        val json = """
        {
          "generatedAt": "2026-10-30T14:02:11.000Z",
          "shipCamVideoId": "AwP_Q6IGwFs",
          "upcoming": [{
            "mmsi": 316001234, "name": "ALGOMA EQUINOX", "imo": 9613927, "callSign": "CFK9876",
            "shipType": 70, "shipTypeName": "Cargo", "category": "cargo",
            "length": 225, "width": 24, "draught": 8.1, "destination": "THUNDER BAY",
            "cargo": "Likely going to load grain", "flag": "CA",
            "position": { "latitude": 42.95, "longitude": -82.42, "sog": 11.2, "cog": 2.5,
                          "heading": 3, "navStatus": 0, "time": "2026-10-30T14:01:50Z" },
            "approach": { "etaMinutes": 8.4, "eta": "2026-10-30T14:10:35.000Z",
                          "distanceNM": 1.6, "direction": "upbound" },
            "info": { "wikidataId": "Q123", "wikidataUrl": "https://www.wikidata.org/wiki/Q123",
                      "yearBuilt": 2013, "operator": "Algoma Central", "grossTonnage": 24300,
                      "imageUrl": "https://commons.wikimedia.org/x.jpg" }
          }],
          "recent": [{
            "mmsi": 366999000, "name": "AMERICAN SPIRIT",
            "passage": { "time": "2026-10-30T12:44:00.000Z", "direction": "downbound" }
          }]
        }
        """
        val snapshot = ApiJson.decodeFromString<BridgeSnapshot>(json)
        assertEquals("AwP_Q6IGwFs", snapshot.shipCamVideoId)
        val ship = snapshot.upcoming.first()
        assertEquals("ALGOMA EQUINOX", ship.name)
        assertEquals(ShipCategory.Cargo, ship.category)
        assertEquals("🇨🇦", ship.flagEmoji)
        assertEquals("Cargo · 225 m", ship.summary)
        assertEquals(Direction.Upbound, ship.approach?.direction)
        assertEquals(Instant.ofEpochSecond(1_793_369_435), ship.approach?.eta)
        // Dates without fractional seconds decode too
        assertEquals(Instant.ofEpochSecond(1_793_368_910), ship.position?.time)
        assertEquals("Algoma Central", ship.info?.operator)
        assertEquals(1, ship.info?.allPhotos?.size)
        val passed = snapshot.recent.first()
        assertEquals(Direction.Downbound, passed.lastPassage?.direction)
        assertNull(passed.position)
        assertNull(passed.info)
    }

    @Test fun decodesAttributionAndShipsWithoutPositions() {
        val json = """
        {
          "generatedAt": "2026-10-30T14:02:11.000Z",
          "attribution": [
            { "text": "Data: AISHub contributors", "url": "https://www.aishub.net" },
            { "text": "AISStream.io", "url": "https://aisstream.io" }
          ],
          "upcoming": [{
            "mmsi": 316001234, "name": "ALGOMA EQUINOX", "category": "cargo",
            "approach": { "etaMinutes": 8.4, "eta": "2026-10-30T14:10:35.000Z",
                          "distanceNM": 1.6, "direction": "upbound" }
          }],
          "recent": []
        }
        """
        val snapshot = ApiJson.decodeFromString<BridgeSnapshot>(json)
        assertEquals(
            listOf(Attribution("Data: AISHub contributors", "https://www.aishub.net"), Attribution("AISStream.io", "https://aisstream.io")),
            snapshot.attribution,
        )
        // A ship whose position came from AISHub: an approach, but no position
        val ship = snapshot.upcoming.first()
        assertNull(ship.position)
        assertEquals(1.6, ship.approach!!.distanceNM, 0.0)
    }

    @Test fun toleratesServersWithoutAttributionAndUnknownFields() {
        val json = """{ "generatedAt": "2026-10-30T14:02:11Z", "upcoming": [], "recent": [], "somethingNew": 1 }"""
        assertNull(ApiJson.decodeFromString<BridgeSnapshot>(json).attribution)
    }

    @Test fun toleratesUnknownCategories() {
        val ship = ApiJson.decodeFromString<Ship>("""{ "mmsi": 1, "name": "X", "category": "submarine" }""")
        assertNull(ship.category)
    }

    @Test fun decodesShipWithPassages() {
        val json = """
        {
          "mmsi": 316001234, "name": "ALGOMA EQUINOX",
          "passages": [
            { "time": "2026-10-30T12:44:00.000Z", "direction": "downbound" },
            { "time": "2026-10-28T09:10:00.000Z", "direction": "upbound" }
          ]
        }
        """
        val ship = ApiJson.decodeFromString<Ship>(json)
        assertEquals(2, ship.passages?.size)
        assertEquals(Direction.Downbound, ship.lastPassage?.direction)
        assertNull(ship.approach)
    }

    @Test fun decodesRegisterDetailsWithoutWikidata() {
        val json = """
        {
          "mmsi": 316001234, "name": "ALGOMA EQUINOX",
          "info": {
            "yearBuilt": 2012, "grossTonnage": 24451,
            "photos": [
              { "url": "https://upload.wikimedia.org/a.jpg", "pageUrl": "https://commons.wikimedia.org/wiki/File:A.jpg",
                "artist": "Pete Markham", "license": "CC BY-SA 2.0", "year": 2012 },
              { "url": "https://upload.wikimedia.org/b.jpg" }
            ],
            "registry": { "source": "transport-canada", "officialNumber": "837491", "hullNumber": "MD-149-GB-01",
                          "portOfRegistry": "ST. CATHARINES", "enginePowerKw": 6929 },
            "uscg": { "source": "uscg", "vesselId": 1225032, "serviceType": "Freight Ship",
                      "serviceSubType": "General", "deadweight": 36480 }
          }
        }
        """
        val ship = ApiJson.decodeFromString<Ship>(json)
        assertNull(ship.info?.wikidataId)
        assertEquals(2012, ship.info?.yearBuilt)
        assertEquals("ST. CATHARINES", ship.info?.registry?.portOfRegistry)
        assertEquals(36480.0, ship.info?.uscg?.deadweight)
        assertEquals("MD-149-GB-01", ship.info?.registry?.hullNumber)
        assertEquals(2, ship.info?.allPhotos?.size)
        assertEquals("Pete Markham · CC BY-SA 2.0", ship.info?.allPhotos?.first()?.credit)
        val titles = ShipLinks.forShip(ship).map { it.title }
        assertTrue("USCG vessel records" in titles)
        assertTrue("Transport Canada vessel register" in titles)
        assertFalse("Wikidata" in titles)
    }

    @Test fun rejectsBadDates() {
        assertThrows(Exception::class.java) {
            ApiJson.decodeFromString<Passage>("""{ "time": "yesterday", "direction": "upbound" }""")
        }
    }

    @Test fun rejectsMissingRequiredFields() {
        assertThrows(SerializationException::class.java) { ApiJson.decodeFromString<Ship>("""{ "mmsi": 1 }""") }
    }

    @Test fun linksToVesselPages() {
        val links = ShipLinks.forShip(Ship(mmsi = 316001234, name = "ALGOMA EQUINOX"))
        val urls = links.map { it.url }
        assertTrue("https://www.vesselfinder.com/vessels/details/316001234" in urls)
        assertTrue("https://www.marinetraffic.com/en/ais/details/ships/mmsi:316001234" in urls)
        assertFalse(links.any { it.title == "Wikipedia" })
        // By IMO when known
        val byImo = ShipLinks.forShip(Ship(mmsi = 316001234, name = "X", imo = 9613927)).map { it.url }
        assertTrue("https://www.marinetraffic.com/en/ais/details/ships/imo:9613927" in byImo)
    }

    @Test fun linksToShipCam() {
        assertEquals("https://www.youtube.com/watch?v=abc", ShipLinks.shipCam("abc"))
        assertNull(ShipLinks.shipCam(null))
    }

    @Test fun ignoresBadFlags() {
        assertNull(Ship(mmsi = 1, name = "X", flag = "C").flagEmoji)
        assertNull(Ship(mmsi = 1, name = "X", flag = "1A").flagEmoji)
        assertEquals("🇺🇸", Ship(mmsi = 1, name = "X", flag = "us").flagEmoji)
    }
}
