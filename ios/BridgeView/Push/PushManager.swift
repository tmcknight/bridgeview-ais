import ActivityKit
import Foundation
import Observation
import UIKit
import UserNotifications
import os

/// Registers this device for bridge alerts: asks for notification permission,
/// collects the APNs device token and the Live Activity push-to-start token,
/// and sends them with the user's alert preferences to the server.
@MainActor
@Observable
final class PushManager {
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var liveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
    private(set) var deviceToken: String?
    /// Kept between launches: iOS doesn't always hand it over again straight away
    /// (or at all, until it changes), and a registration sent without it would
    /// leave the server unable to start Live Activities
    private(set) var pushToStartToken: String?
    private(set) var lastRegistrationError: String?

    private let api: APIClient
    private let nearBridge: NearBridgeMonitor
    private let logger = Logger(subsystem: "BridgeView", category: "push")
    private var registrationTask: Task<Void, Never>?
    private var lastRegistration: (token: String, body: DeviceRegistration)?

    /// Per push environment: an Xcode build's (sandbox) token is refused by
    /// production APNs, and a TestFlight build installed over it keeps its
    /// UserDefaults, so it would send that token, the server would drop it as bad,
    /// and the phone's Live Activities would quietly become plain notifications
    private static let pushToStartTokenKey = "push.pushToStartToken.\(AppConfig.pushEnvironment)"
    /// Before tokens were kept per environment; which build saved it isn't known
    private static let legacyPushToStartTokenKey = "push.pushToStartToken"

    /// Follows the Live Activity tokens from launch, background launches too (a
    /// geofence crossing), which never show the window that calls `start()`
    init(api: APIClient = APIClient(), nearBridge: NearBridgeMonitor) {
        self.api = api
        self.nearBridge = nearBridge
        // The server keeps the token it already has when a registration has none,
        // so forgetting an unknown one costs nothing
        UserDefaults.standard.removeObject(forKey: Self.legacyPushToStartTokenKey)
        pushToStartToken = UserDefaults.standard.string(forKey: Self.pushToStartTokenKey)
        observeLiveActivityTokens()
    }

    /// Ask for permission (first launch only shows the prompt) and register with APNs
    func start() async {
        let center = UNUserNotificationCenter.current()
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            logger.error("Notification authorization failed: \(error.localizedDescription)")
        }
        await refreshAuthorization()
        UIApplication.shared.registerForRemoteNotifications()
    }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        liveActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
    }

    func didRegister(deviceToken data: Data) {
        deviceToken = data.hexString
        scheduleRegistration(immediately: true)
    }

    func didFailToRegister(_ error: Error) {
        logger.error("APNs registration failed: \(error.localizedDescription)")
        lastRegistrationError = error.localizedDescription
    }

    /// Settings changed; send them after the user stops fiddling
    func preferencesChanged() {
        scheduleRegistration(immediately: false)
    }

    /// The phone came near the bridge or left (alerts pause while it's away)
    func nearBridgeChanged() {
        scheduleRegistration(immediately: true)
    }

    private func observeLiveActivityTokens() {
        Task { [weak self] in
            for await data in Activity<ShipApproachAttributes>.pushToStartTokenUpdates {
                guard let self else { return }
                pushToStartToken = data.hexString
                UserDefaults.standard.set(data.hexString, forKey: Self.pushToStartTokenKey)
                logger.debug("Push-to-start token: \(data.hexString, privacy: .public)")
                scheduleRegistration(immediately: true)
            }
        }
        Task { [weak self] in
            for await enabled in ActivityAuthorizationInfo().activityEnablementUpdates {
                guard let self else { return }
                liveActivitiesEnabled = enabled
                scheduleRegistration(immediately: true)
            }
        }
    }

    /// The app came to the front: send anything that didn't get through (a
    /// crossing reported while suspended, a change made while offline)
    func appBecameActive() {
        scheduleRegistration(immediately: true)
    }

    /// The app is leaving the screen: send a change still waiting out its delay
    /// (a ship followed just before closing the app) now, while iOS still lets the
    /// app run, or the server won't know until the app is next opened
    /// (nothing is sent when the server already has these settings)
    func appLeftForeground() {
        scheduleRegistration(immediately: true)
    }

    /// Waits before each try; failures (offline, the server restarting) are tried
    /// again, so the server isn't left on old settings, such as alerts paused
    private static let attemptDelays: [Duration] = [.zero, .seconds(5), .seconds(30), .seconds(120), .seconds(600)]

    private func scheduleRegistration(immediately: Bool) {
        registrationTask?.cancel()
        registrationTask = Task { [weak self] in
            if !immediately {
                try? await Task.sleep(for: .seconds(1))
            }
            for delay in Self.attemptDelays {
                if delay > .zero { try? await Task.sleep(for: delay) }
                guard !Task.isCancelled, let self else { return }
                // Finish sending even if iOS suspends the app (a background launch
                // for a crossing gets only a few seconds). Only around the request:
                // holding it through the waits would get the app killed
                let background = UIApplication.shared.beginBackgroundTask(withName: "Register for alerts")
                let done = await register()
                if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
                if done { return }
            }
        }
    }

    /// Sends the registration if it changed. False when it should be tried again.
    private func register() async -> Bool {
        guard let deviceToken else { return true }
        let body = DeviceRegistration(
            environment: AppConfig.pushEnvironment,
            preferences: .load(),
            nearBridge: nearBridge.effectiveIsNear,
            pushToStartToken: pushToStartToken,
            liveActivities: liveActivitiesEnabled
        )
        if let last = lastRegistration, last.token == deviceToken, last.body == body { return true }
        do {
            try await api.register(deviceToken: deviceToken, body)
            lastRegistration = (deviceToken, body)
            lastRegistrationError = nil
            return true
        } catch {
            // A newer change took over; it sends the latest settings itself
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { return true }
            logger.error("Device registration failed: \(error.localizedDescription)")
            lastRegistrationError = APIError.message(for: error)
            // The server refused this body: sending it again won't help
            switch error as? APIError {
            case .notFound: return true
            case .status(let code) where (400..<500).contains(code) && code != 429: return true
            default: return false
            }
        }
    }
}

extension Data {
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
