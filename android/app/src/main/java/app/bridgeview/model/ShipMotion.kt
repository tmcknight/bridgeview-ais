package app.bridgeview.model

import java.time.Duration
import java.time.Instant
import kotlin.math.abs

/**
 * Smooth movement between position reports, as on the web map (src/utils/motion.ts)
 * and the iOS app (ShipMotion.swift). Each ship is dead-reckoned from its latest
 * report, and when a newer report lands the gap between where it was drawn and
 * where the report puts it closes over [BLEND] instead of in one jump, its heading
 * turning the same way.
 */
class ShipMotion {
    companion object {
        val BLEND: Duration = Duration.ofSeconds(2)
        /** A new report further than this from where the ship was drawn (~2 km) is jumped to */
        const val MAX_BLEND_DEGREES = 0.02

        private fun normalized(degrees: Double): Double = ((degrees % 360) + 360) % 360

        /** The shortest turn from `from` to `to`, in -180..<180 */
        fun turn(from: Double, to: Double): Double = normalized(to - from + 180) - 180
    }

    data class Drawn(val coordinate: Coordinate, /** Degrees the marker points, when known */ val course: Double?)

    private data class Track(
        val position: Position,
        /** When the report was taken in */
        val since: Instant,
        /** Where it was drawn minus where the report put it, when the report was taken in */
        val dLat: Double = 0.0,
        val dLon: Double = 0.0,
        val dCourse: Double = 0.0,
    )

    private var tracks: Map<Int, Track> = emptyMap()

    /**
     * Takes in the ships' latest positions; ships no longer sent are forgotten.
     * Reports no newer than the one already held are ignored, so a ship never steps back.
     */
    fun update(ships: List<Ship>, now: Instant = Instant.now()) {
        val next = HashMap<Int, Track>()
        for (ship in ships) {
            val position = ship.position ?: continue
            val track = tracks[ship.mmsi]
            if (track == null) {
                next[ship.mmsi] = Track(position, now)
                continue
            }
            val replacement = position.time == track.position.time && position != track.position
            if (!(position.time.isAfter(track.position.time) || replacement)) {
                next[ship.mmsi] = track
                continue
            }
            val shown = drawn(track, now)
            val target = position.coordinateAt(now)
            val dLat = shown.coordinate.latitude - target.latitude
            val dLon = shown.coordinate.longitude - target.longitude
            next[ship.mmsi] = if (abs(dLat) < MAX_BLEND_DEGREES && abs(dLon) < MAX_BLEND_DEGREES) {
                val from = shown.course
                val to = position.course
                Track(position, now, dLat, dLon, if (from != null && to != null) turn(to, from) else 0.0)
            } else {
                Track(position, now)
            }
        }
        tracks = next
    }

    /**
     * Where to draw the ship at `date`: its taken-in report moved on, eased from where
     * it was drawn before. Ships not taken in yet are drawn from their own report.
     */
    fun drawn(ship: Ship, date: Instant): Drawn? {
        tracks[ship.mmsi]?.let { return drawn(it, date) }
        val position = ship.position ?: return null
        return Drawn(position.coordinateAt(date), position.course)
    }

    /** Whether any ship is still moving or easing, so the map needs redrawing */
    fun isMoving(date: Instant): Boolean = tracks.values.any { track ->
        Duration.between(track.since, date) < BLEND ||
            (track.position.isUnderWay && Duration.between(track.position.time, date) < MAX_DEAD_RECKONING)
    }

    private fun drawn(track: Track, date: Instant): Drawn {
        val reckoned = track.position.coordinateAt(date)
        // Smoothstep: the correction starts and ends gently, so the ship's speed never jumps
        val t = (Duration.between(track.since, date).toMillis().toDouble() / BLEND.toMillis()).coerceIn(0.0, 1.0)
        val remaining = 1 - t * t * (3 - 2 * t)
        val coordinate = Coordinate(
            reckoned.latitude + track.dLat * remaining,
            reckoned.longitude + track.dLon * remaining,
        )
        val course = track.position.course?.let { normalized(it + track.dCourse * remaining) }
        return Drawn(coordinate, course)
    }
}
