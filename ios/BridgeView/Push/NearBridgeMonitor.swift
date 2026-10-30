import CoreLocation
import Foundation
import Observation
import os

/// Whether this phone is near the bridge, for "only near the bridge" alerts.
///
/// Watches a circle around the bridge with `CLMonitor`, so iOS wakes the app
/// (even when it isn't running) when the phone goes in or out. The location
/// never leaves the phone: `PushManager` only turns the device's `enabled` off
/// while it's away. Needs Always location access; without it, or before the
/// first reading, the answer is nil and alerts aren't held back.
@MainActor
@Observable
final class NearBridgeMonitor: NSObject, CLLocationManagerDelegate {
    /// Letters and digits only (CLMonitor asserts otherwise)
    private static let monitorName = "BridgeViewNearBridge"
    private static let conditionID = "bridge"
    private static let lastStateKey = "nearBridge.last"

    private(set) var authorization: CLAuthorizationStatus = .notDetermined
    /// Inside the circle, as last reported; nil when unknown
    private(set) var isNear: Bool?

    /// What alerts should go by: nil unless location can be watched in the background
    var effectiveIsNear: Bool? {
        authorization == .authorizedAlways ? isNear : nil
    }

    /// Called when `effectiveIsNear` may have changed
    @ObservationIgnored var onChange: (@MainActor () -> Void)?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var monitor: Task<CLMonitor, Never>?
    @ObservationIgnored private let logger = Logger(subsystem: "BridgeView", category: "location")

    override init() {
        super.init()
        manager.delegate = self
        authorization = manager.authorizationStatus
        isNear = UserDefaults.standard.object(forKey: Self.lastStateKey) as? Bool
    }

    /// Start, move or stop watching to match the alert settings. Call at launch
    /// too: after iOS relaunches the app for a crossing, the monitor must be
    /// opened again to receive it.
    func update(_ preferences: AlertPreferences) async {
        guard preferences.enabled, preferences.nearBridgeOnly else {
            if let monitor {
                await monitor.value.remove(Self.conditionID)
            }
            setNear(nil)
            return
        }
        if authorization == .notDetermined || authorization == .authorizedWhenInUse {
            // Shows a prompt only the first time; later the system offers the upgrade
            manager.requestAlwaysAuthorization()
        }
        let condition = CLMonitor.CircularGeographicCondition(
            center: Bridge.center,
            radius: CLLocationDistance(preferences.nearBridgeRadius * 1000)
        )
        // Adding under the same identifier replaces the old circle
        await openMonitor().add(condition, identifier: Self.conditionID)
    }

    private func openMonitor() async -> CLMonitor {
        if let monitor { return await monitor.value }
        // Only one CLMonitor may be open per name, so share the one task
        let task = Task { await CLMonitor(Self.monitorName) }
        monitor = task
        let opened = await task.value
        Task { [weak self] in
            do {
                for try await event in await opened.events {
                    self?.handle(event.state)
                }
            } catch {
                self?.logger.error("Location monitor stopped: \(error.localizedDescription)")
            }
        }
        return opened
    }

    private func handle(_ state: CLMonitor.Event.State) {
        switch state {
        case .satisfied: setNear(true)
        case .unsatisfied: setNear(false)
        default: setNear(nil)
        }
    }

    private func setNear(_ near: Bool?) {
        guard near != isNear else { return }
        isNear = near
        UserDefaults.standard.set(near, forKey: Self.lastStateKey)
        onChange?()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard status != self.authorization else { return }
            self.authorization = status
            self.onChange?()
        }
    }
}
