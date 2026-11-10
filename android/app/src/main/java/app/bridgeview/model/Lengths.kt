package app.bridgeview.model

import android.content.Context
import android.icu.util.LocaleData
import android.icu.util.ULocale
import app.bridgeview.R
import app.bridgeview.graph
import java.util.Locale
import kotlin.math.roundToLong

/** The unit ship lengths, widths and draughts are shown in; `raw` is what the server is sent */
enum class LengthUnit(val raw: String) {
    Metres("m"),
    Feet("ft"),
}

/** The "Lengths" setting, stored in [app.bridgeview.data.Prefs] */
enum class LengthSetting(val raw: String) {
    Automatic("auto"),
    Metres("m"),
    Feet("ft"),
    ;

    /** Automatic is feet where the phone's region measures in US units, else metres */
    fun resolve(usesUsMeasurement: Boolean = Lengths.localeUsesUsMeasurement()): LengthUnit = when (this) {
        Automatic -> if (usesUsMeasurement) LengthUnit.Feet else LengthUnit.Metres
        Metres -> LengthUnit.Metres
        Feet -> LengthUnit.Feet
    }

    companion object {
        fun fromRaw(raw: String?): LengthSetting = entries.firstOrNull { it.raw == raw } ?: Automatic
    }
}

/**
 * Ship lengths, widths and draughts in the user's unit, written and spoken. The
 * figures from the server are always metres. `metresWord` is the spoken unit
 * ("metres", or "meters" in US English), from string resources.
 */
class Lengths(val unit: LengthUnit, private val metresWord: String = "metres") {
    /** "225 m" or "738 ft" */
    fun length(metres: Int): String = "${figure(metres.toDouble())} ${unit.raw}"

    /** "225 metres" or "738 feet" */
    fun spokenLength(metres: Int): String = "${figure(metres.toDouble())} $spokenUnit"

    /** "225 × 24 m", or "225 m long" without a width */
    fun size(length: Int, width: Int?): String =
        if (width != null) "${figure(length.toDouble())} × ${figure(width.toDouble())} ${unit.raw}" else "${length(length)} long"

    /** "225 by 24 metres", or "225 metres long" */
    fun spokenSize(length: Int, width: Int?): String =
        if (width != null) "${figure(length.toDouble())} by ${figure(width.toDouble())} $spokenUnit" else "${spokenLength(length)} long"

    /** "7.9 m", or "26 ft" (whole feet) */
    fun draught(metres: Double): String = "${draughtFigure(metres)} ${unit.raw}"

    /** "7.9 metres" or "26 feet" */
    fun spokenDraught(metres: Double): String = "${draughtFigure(metres)} $spokenUnit"

    /** The alert setting's minimum length: "100 m", or "330 ft" (to the nearest 10 ft) */
    fun minimum(metres: Int): String = when (unit) {
        LengthUnit.Metres -> length(metres)
        LengthUnit.Feet -> "${group((metres * FEET_PER_METRE / 10).roundToLong() * 10)} ft"
    }

    /** "Cargo · 225 m" */
    fun summary(typeName: String?, length: Int?): String =
        listOfNotNull(typeName, length?.let(::length)).joinToString(" · ")

    /** "Cargo, 225 metres" */
    fun spokenSummary(typeName: String?, length: Int?): String =
        listOfNotNull(typeName, length?.let(::spokenLength)).joinToString(", ")

    fun summary(ship: Ship): String = summary(ship.shipTypeName, ship.length)

    fun summary(ship: ShipSummary): String = summary(ship.shipTypeName, ship.length)

    fun spokenSummary(ship: Ship): String = spokenSummary(ship.shipTypeName, ship.length)

    fun spokenSummary(ship: ShipSummary): String = spokenSummary(ship.shipTypeName, ship.length)

    /**
     * The longest round distance no longer than `metres`, for a map scale bar:
     * its length in metres and its label ("500 m", "2 km"; "1,000 ft", "2 mi")
     */
    fun scaleStep(metres: Double): Pair<Double, String> {
        val steps = when (unit) {
            LengthUnit.Metres -> METRIC_SCALE
            LengthUnit.Feet -> IMPERIAL_SCALE
        }
        return steps.lastOrNull { it.first <= metres } ?: steps.first()
    }

    private val spokenUnit: String get() = if (unit == LengthUnit.Feet) "feet" else metresWord

    private fun figure(metres: Double): String = when (unit) {
        LengthUnit.Metres -> group(metres.roundToLong())
        LengthUnit.Feet -> group(Math.round(metres * FEET_PER_METRE))
    }

    private fun draughtFigure(metres: Double): String = when (unit) {
        LengthUnit.Metres -> String.format(Locale.US, "%.1f", metres)
        LengthUnit.Feet -> group(Math.round(metres * FEET_PER_METRE))
    }

    private fun group(value: Long): String = String.format(Locale.US, "%,d", value)

    companion object {
        const val FEET_PER_METRE = 3.28084
        private const val METRES_PER_FOOT = 0.3048
        private const val METRES_PER_MILE = 1609.344

        private val METRIC_SCALE = listOf(50, 100, 200, 500).map { it.toDouble() to "$it m" } +
            listOf(1, 2, 5, 10, 20, 50).map { it * 1000.0 to "$it km" }

        private val IMPERIAL_SCALE = listOf(100, 200, 500, 1000, 2000).map { it * METRES_PER_FOOT to String.format(Locale.US, "%,d ft", it) } +
            listOf(1, 2, 5, 10, 20).map { it * METRES_PER_MILE to "$it mi" }

        /** Whether the phone's region measures in US units (the US, Liberia, Myanmar) */
        fun localeUsesUsMeasurement(): Boolean =
            LocaleData.getMeasurementSystem(ULocale.getDefault()) == LocaleData.MeasurementSystem.US

        /** The user's lengths, for code outside Compose (notifications, registration) */
        fun current(context: Context): Lengths = Lengths(
            LengthSetting.fromRaw(context.graph.prefs.lengthUnit.value).resolve(),
            context.getString(R.string.unit_metres_spoken),
        )
    }
}

/**
 * How far from the bridge "near" reaches, for pausing alerts while away (as on
 * iOS). Stored in metres; offered in kilometres or, with US units, miles. A value
 * saved under the other system snaps to the nearest choice in this one, and that's
 * what's used.
 */
object NearBridgeRadius {
    const val DEFAULT_METRES = 5_000

    val metricOptions = listOf(2_000, 5_000, 10_000, 25_000)
    val usOptions = listOf(1.0, 3.0, 5.0, 15.0).map { Math.round(it * 1_609.344).toInt() }

    fun options(unit: LengthUnit): List<Int> = if (unit == LengthUnit.Feet) usOptions else metricOptions

    /** The choice closest to `metres` in this unit system */
    fun nearest(metres: Int, unit: LengthUnit): Int =
        options(unit).minByOrNull { kotlin.math.abs(it - metres) } ?: DEFAULT_METRES

    /** "5 km" or "3 mi" */
    fun label(metres: Int, unit: LengthUnit): String = when (unit) {
        LengthUnit.Metres -> "${Math.round(metres / 1000.0)} km"
        LengthUnit.Feet -> "${Math.round(metres / 1_609.344)} mi"
    }
}
