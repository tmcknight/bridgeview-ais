import CoreLocation

extension Position {
    /// Ships reported further back than this aren't moved on: they may have stopped or turned
    static let maxDeadReckoning: TimeInterval = 3 * 60
    private static let metresPerNM = 1852.0
    private static let metresPerDegreeLatitude = 111_320.0

    /// Under way: moving at half a knot or more, with a course, and not at anchor or moored
    var isUnderWay: Bool {
        guard let sog, sog >= 0.5, let cog, cog < 360 else { return false }
        return navStatus != 1 && navStatus != 5
    }

    /// Where the ship should be at `date`, moved on from its last report along its
    /// course at its speed (for at most `maxDeadReckoning`)
    func coordinate(at date: Date) -> CLLocationCoordinate2D {
        let reported = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        guard isUnderWay, let sog, let cog else { return reported }
        let elapsed = min(max(date.timeIntervalSince(time), 0), Self.maxDeadReckoning)
        let metres = sog * Self.metresPerNM / 3600 * elapsed
        let bearing = cog * .pi / 180
        let dLat = metres * cos(bearing) / Self.metresPerDegreeLatitude
        let dLon = metres * sin(bearing) / (Self.metresPerDegreeLatitude * cos(latitude * .pi / 180))
        return CLLocationCoordinate2D(latitude: latitude + dLat, longitude: longitude + dLon)
    }
}
