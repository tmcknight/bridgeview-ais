import Observation

/// Which screen is showing; notification and Live Activity taps open a ship
@MainActor
@Observable
final class Router {
    enum Tab: Hashable {
        case upcoming, recent, settings
    }

    var tab: Tab = .upcoming
    /// Ship opened from outside the app (notification or Live Activity tap)
    var openedShip: ShipLink?

    func open(mmsi: Int) {
        openedShip = ShipLink(mmsi: mmsi)
    }
}

struct ShipLink: Identifiable, Hashable {
    var mmsi: Int
    var id: Int { mmsi }
}
