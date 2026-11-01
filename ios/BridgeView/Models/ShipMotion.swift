import CoreLocation

/// Smooth movement between position reports, as on the web map (src/utils/motion.ts).
/// Each ship is dead-reckoned from its latest report, and when a newer report lands
/// the gap between where it was drawn and where the report puts it closes over
/// `blend` instead of in one jump, its heading turning the same way.
struct ShipMotion {
    static let blend: TimeInterval = 2
    /// How often a map with moving ships is redrawn
    static let frameInterval: TimeInterval = 1.0 / 30
    /// A new report further than this from where the ship was drawn (~2 km) is jumped to
    static let maxBlendDegrees = 0.02

    struct Drawn: Equatable {
        var coordinate: CLLocationCoordinate2D
        /// Degrees the marker points, when known
        var course: Double?

        static func == (a: Drawn, b: Drawn) -> Bool {
            a.coordinate.latitude == b.coordinate.latitude
                && a.coordinate.longitude == b.coordinate.longitude
                && a.course == b.course
        }
    }

    private struct Track {
        var position: Position
        /// When the report was taken in
        var since: Date
        /// Where it was drawn minus where the report put it, when the report was taken in
        var dLat = 0.0
        var dLon = 0.0
        var dCourse = 0.0
    }

    private var tracks: [Int: Track] = [:]

    /// Takes in the ships' latest positions; ships no longer sent are forgotten.
    /// Reports no newer than the one already held are ignored, so a ship never steps back.
    mutating func update(_ ships: [Ship], at now: Date = .now) {
        var next: [Int: Track] = [:]
        for ship in ships {
            guard let position = ship.position else { continue }
            guard let track = tracks[ship.mmsi] else {
                next[ship.mmsi] = Track(position: position, since: now)
                continue
            }
            guard position.time > track.position.time || position.isReplacement(of: track.position) else {
                next[ship.mmsi] = track
                continue
            }
            let shown = Self.drawn(track, at: now)
            let target = position.coordinate(at: now)
            var fresh = Track(position: position, since: now)
            let dLat = shown.coordinate.latitude - target.latitude
            let dLon = shown.coordinate.longitude - target.longitude
            if abs(dLat) < Self.maxBlendDegrees, abs(dLon) < Self.maxBlendDegrees {
                fresh.dLat = dLat
                fresh.dLon = dLon
                if let from = shown.course, let to = position.course {
                    fresh.dCourse = Self.turn(from: to, to: from)
                }
            }
            next[ship.mmsi] = fresh
        }
        tracks = next
    }

    /// Where to draw the ship at `date`: its taken-in report moved on, eased from where
    /// it was drawn before. Ships not taken in yet are drawn from their own report.
    func drawn(_ ship: Ship, at date: Date) -> Drawn? {
        if let track = tracks[ship.mmsi] { return Self.drawn(track, at: date) }
        guard let position = ship.position else { return nil }
        return Drawn(coordinate: position.coordinate(at: date), course: position.course)
    }

    /// Whether any ship is still moving or easing, so the map needs redrawing
    func isMoving(at date: Date) -> Bool {
        tracks.values.contains { track in
            date.timeIntervalSince(track.since) < Self.blend
                || (track.position.isUnderWay
                    && date.timeIntervalSince(track.position.time) < Position.maxDeadReckoning)
        }
    }

    private static func drawn(_ track: Track, at date: Date) -> Drawn {
        let reckoned = track.position.coordinate(at: date)
        // Smoothstep: the correction starts and ends gently, so the ship's speed never jumps
        let t = min(max(date.timeIntervalSince(track.since) / blend, 0), 1)
        let remaining = 1 - t * t * (3 - 2 * t)
        let coordinate = CLLocationCoordinate2D(
            latitude: reckoned.latitude + track.dLat * remaining,
            longitude: reckoned.longitude + track.dLon * remaining
        )
        let course = track.position.course.map { normalized($0 + track.dCourse * remaining) }
        return Drawn(coordinate: coordinate, course: course)
    }

    private static func normalized(_ degrees: Double) -> Double {
        (degrees.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    }

    /// The shortest turn from `from` to `to`, in -180..<180
    static func turn(from: Double, to: Double) -> Double {
        normalized(to - from + 180) - 180
    }
}

private extension Position {
    /// Same report time but different details (another feed's copy): taken in without going back
    func isReplacement(of other: Position) -> Bool {
        time == other.time && self != other
    }
}
