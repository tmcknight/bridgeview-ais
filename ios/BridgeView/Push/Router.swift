import Observation

/// Which screen is showing; notification and Live Activity taps open a ship
@MainActor
@Observable
final class Router {
    enum Tab: Hashable {
        case upcoming, map, recent, settings
    }

    var tab: Tab = .upcoming
    /// Ship opened from outside the app (notification or Live Activity tap)
    var openedShip: ShipLink?
    /// Ship to show on the map (the Live Activity's Map button); the map clears it
    /// once it has it in view
    var mapShip: Int?
    /// The ship cam was asked for (the Live Activity's button); opened once its
    /// video is known
    var camRequested = false

    func open(mmsi: Int) {
        openedShip = ShipLink(mmsi: mmsi)
    }

    func open(_ target: DeepLink.Target) {
        switch target {
        case .ship(let mmsi):
            open(mmsi: mmsi)
        case .map(let mmsi):
            openedShip = nil
            tab = .map
            mapShip = mmsi
        case .cam:
            camRequested = true
        }
    }
}

struct ShipLink: Identifiable, Hashable {
    var mmsi: Int
    var id: Int { mmsi }
}
