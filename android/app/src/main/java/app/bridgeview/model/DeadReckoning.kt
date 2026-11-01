package app.bridgeview.model

import java.time.Duration
import java.time.Instant
import kotlin.math.cos
import kotlin.math.sin

data class Coordinate(val latitude: Double, val longitude: Double)

/** Ships reported further back than this aren't moved on: they may have stopped or turned */
val MAX_DEAD_RECKONING: Duration = Duration.ofMinutes(3)
private const val METRES_PER_NM = 1852.0
const val METRES_PER_DEGREE_LATITUDE = 111_320.0

/** Under way: moving at half a knot or more, with a course, and not at anchor or moored */
val Position.isUnderWay: Boolean
    get() {
        val sog = sog ?: return false
        val cog = cog ?: return false
        if (sog < 0.5 || cog >= 360) return false
        return navStatus != 1 && navStatus != 5
    }

/**
 * Where the ship should be at `date`, moved on from its last report along its
 * course at its speed (for at most [MAX_DEAD_RECKONING])
 */
fun Position.coordinateAt(date: Instant): Coordinate {
    val reported = Coordinate(latitude, longitude)
    if (!isUnderWay) return reported
    val sog = sog!!
    val cog = cog!!
    val elapsed = (Duration.between(time, date).toMillis() / 1000.0)
        .coerceIn(0.0, MAX_DEAD_RECKONING.seconds.toDouble())
    val metres = sog * METRES_PER_NM / 3600 * elapsed
    val bearing = Math.toRadians(cog)
    val dLat = metres * cos(bearing) / METRES_PER_DEGREE_LATITUDE
    val dLon = metres * sin(bearing) / (METRES_PER_DEGREE_LATITUDE * cos(Math.toRadians(latitude)))
    return Coordinate(latitude + dLat, longitude + dLon)
}
