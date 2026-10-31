import CoreLocation
import Foundation
import Observation

/// Which way the phone is pointing, so direction arrows can turn like a compass
/// needle: pointing the way a ship is going as seen by someone holding the phone.
///
/// Runs only while an arrow is on screen (`start`/`stop` are counted). Heading
/// needs no location permission; with it the heading is true, otherwise magnetic
/// (a few degrees off here, fine for an arrow).
@MainActor
@Observable
final class Compass: NSObject, CLLocationManagerDelegate {
    /// Degrees clockwise from north, unwrapped (it can run past 360 or below 0)
    /// so an animated arrow turns the short way across north; nil when unknown
    private(set) var heading: Double?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var users = 0

    override init() {
        super.init()
        manager.delegate = self
        manager.headingFilter = 2
    }

    func start() {
        users += 1
        guard users == 1, CLLocationManager.headingAvailable() else { return }
        manager.startUpdatingHeading()
    }

    func stop() {
        users = max(0, users - 1)
        guard users == 0 else { return }
        manager.stopUpdatingHeading()
        heading = nil
    }

    private func update(_ degrees: Double) {
        guard let heading else {
            heading = degrees
            return
        }
        // Shortest turn from the last reading, so the unwrapped value never jumps a lap
        var delta = (degrees - heading).truncatingRemainder(dividingBy: 360)
        if delta > 180 { delta -= 360 } else if delta < -180 { delta += 360 }
        self.heading = heading + delta
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }
        let degrees = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        Task { @MainActor in self.update(degrees) }
    }
}
