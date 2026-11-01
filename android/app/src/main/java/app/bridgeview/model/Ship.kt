package app.bridgeview.model

import app.bridgeview.net.InstantSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/** A ship as the server describes it (ios/API.md, "Ship") */
@Serializable
data class Ship(
    val mmsi: Int,
    val name: String,
    val imo: Int? = null,
    val callSign: String? = null,
    val shipType: Int? = null,
    val shipTypeName: String? = null,
    val category: ShipCategory? = null,
    val length: Int? = null,
    val width: Int? = null,
    val draught: Double? = null,
    val destination: String? = null,
    val cargo: String? = null,
    val flag: String? = null,
    /** Class B transponder (pleasure craft, small workboats) */
    val classB: Boolean? = null,
    val position: Position? = null,
    val approach: Approach? = null,
    val passage: Passage? = null,
    /** Only on GET /api/ships/:mmsi, newest first */
    val passages: List<Passage>? = null,
    val info: VesselInfo? = null,
) {
    /** The latest passage, whichever endpoint the ship came from */
    val lastPassage: Passage? get() = passage ?: passages?.firstOrNull()

    /** "Cargo · 225 m" */
    val summary: String
        get() = listOfNotNull(shipTypeName, length?.let { "$it m" }).joinToString(" · ")

    val flagEmoji: String?
        get() {
            val code = flag?.uppercase() ?: return null
            if (code.length != 2 || !code.all { it in 'A'..'Z' }) return null
            return code.map { String(Character.toChars(127_397 + it.code)) }.joinToString("")
        }
}

@Serializable
data class Position(
    val latitude: Double,
    val longitude: Double,
    val sog: Double? = null,
    val cog: Double? = null,
    val heading: Int? = null,
    val navStatus: Int? = null,
    @Serializable(with = InstantSerializer::class) val time: Instant,
) {
    /**
     * Which way the ship points, in degrees true: its heading, or its course over
     * ground when it sends no heading (AIS uses 511 and 360 for "not available")
     */
    val course: Double?
        get() = when {
            heading != null && heading < 360 -> heading.toDouble()
            cog != null && cog < 360 -> cog
            else -> null
        }
}

@Serializable
data class Approach(
    val etaMinutes: Double,
    @Serializable(with = InstantSerializer::class) val eta: Instant,
    val distanceNM: Double,
    val direction: Direction,
)

@Serializable
data class Passage(
    @Serializable(with = InstantSerializer::class) val time: Instant,
    val direction: Direction,
)

/**
 * Ship details: photo, builder and operator from Wikidata; build year, tonnage,
 * service type and registry from the USCG and Transport Canada registers
 */
@Serializable
data class VesselInfo(
    val wikidataId: String? = null,
    val wikidataUrl: String? = null,
    val name: String? = null,
    val description: String? = null,
    val imageUrl: String? = null,
    val imagePageUrl: String? = null,
    val yearBuilt: Int? = null,
    val builder: String? = null,
    val operator: String? = null,
    val grossTonnage: Double? = null,
    val wikipediaUrl: String? = null,
    val photos: List<VesselPhoto>? = null,
    val registry: RegistryRecord? = null,
    val uscg: UscgRecord? = null,
) {
    /** Every photo, best first: the server's list, else Wikidata's one photo */
    val allPhotos: List<VesselPhoto>
        get() = photos?.takeIf { it.isNotEmpty() }
            ?: imageUrl?.let { listOf(VesselPhoto(url = it, pageUrl = imagePageUrl)) }
            ?: emptyList()
}

/** A photo on Wikimedia Commons, with the credit its licence asks for */
@Serializable
data class VesselPhoto(
    val url: String,
    val pageUrl: String? = null,
    val artist: String? = null,
    val license: String? = null,
    val year: Int? = null,
) {
    /** "Pete Markham · CC BY-SA 2.0" */
    val credit: String?
        get() = listOfNotNull(artist, license).takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/** The ship's entry in Transport Canada's register of large vessels */
@Serializable
data class RegistryRecord(
    val officialNumber: String? = null,
    val hullNumber: String? = null,
    val portOfRegistry: String? = null,
    val enginePowerKw: Double? = null,
)

/** The ship's record in the USCG's Port State Information Exchange */
@Serializable
data class UscgRecord(
    val vesselId: Int,
    val officialNumber: String? = null,
    val serviceType: String? = null,
    val serviceSubType: String? = null,
    val deadweight: Double? = null,
)

@Serializable
enum class ShipCategory(val label: String) {
    @SerialName("cargo") Cargo("Cargo"),
    @SerialName("tanker") Tanker("Tanker"),
    @SerialName("passenger") Passenger("Passenger"),
    @SerialName("other") Other("Other");

    val raw: String get() = name.lowercase()

    companion object {
        val defaultAlerts = setOf(Cargo, Tanker, Passenger)
        fun fromRaw(raw: String): ShipCategory? = entries.firstOrNull { it.raw == raw }
    }
}

/** Upbound = northbound into Lake Huron; downbound = southbound */
@Serializable
enum class Direction(val label: String) {
    @SerialName("upbound") Upbound("Upbound"),
    @SerialName("downbound") Downbound("Downbound");

    val raw: String get() = name.lowercase()

    /** Roughly which way the river runs at the bridge */
    val bearing: Double get() = if (this == Upbound) 0.0 else 180.0

    companion object {
        fun fromRaw(raw: String?): Direction? = entries.firstOrNull { it.raw == raw }
    }
}

/** GET /api/bridge */
@Serializable
data class BridgeSnapshot(
    @Serializable(with = InstantSerializer::class) val generatedAt: Instant,
    val shipCamVideoId: String? = null,
    /** Credits for the AIS feeds the server uses, shown near the ship lists */
    val attribution: List<Attribution>? = null,
    /** Whether the server takes photos shared from the app */
    val photoSharing: Boolean? = null,
    /** Whether the server takes photo reports from the app */
    val photoReporting: Boolean? = null,
    val upcoming: List<Ship>,
    val recent: List<Ship>,
)

/** GET /api/map: every ship heard lately, each with a position */
@Serializable
data class MapSnapshot(
    @Serializable(with = InstantSerializer::class) val generatedAt: Instant,
    val attribution: List<Attribution>? = null,
    val ships: List<Ship>,
)

/** A data credit: `text` linking to `url`. AISHub's terms require its credit near the data. */
@Serializable
data class Attribution(val text: String, val url: String)
