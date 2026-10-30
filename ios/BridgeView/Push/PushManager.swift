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
    private(set) var pushToStartToken: String?
    private(set) var lastRegistrationError: String?

    private let api: APIClient
    private let nearBridge: NearBridgeMonitor
    private let logger = Logger(subsystem: "BridgeView", category: "push")
    private var registrationTask: Task<Void, Never>?
    private var lastRegistration: (token: String, body: DeviceRegistration)?

    init(api: APIClient = APIClient(), nearBridge: NearBridgeMonitor) {
        self.api = api
        self.nearBridge = nearBridge
    }

    /// Ask for permission (first launch only shows the prompt), register with
    /// APNs, and start following the Live Activity tokens
    func start() async {
        let center = UNUserNotificationCenter.current()
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            logger.error("Notification authorization failed: \(error.localizedDescription)")
        }
        await refreshAuthorization()
        UIApplication.shared.registerForRemoteNotifications()
        observeLiveActivityTokens()
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

    private func scheduleRegistration(immediately: Bool) {
        registrationTask?.cancel()
        registrationTask = Task { [weak self] in
            if !immediately {
                try? await Task.sleep(for: .seconds(1))
            }
            guard !Task.isCancelled else { return }
            await self?.register()
        }
    }

    private func register() async {
        guard let deviceToken else { return }
        let body = DeviceRegistration(
            environment: AppConfig.pushEnvironment,
            preferences: .load(),
            nearBridge: nearBridge.effectiveIsNear,
            pushToStartToken: pushToStartToken,
            liveActivities: liveActivitiesEnabled
        )
        if let last = lastRegistration, last.token == deviceToken, last.body == body { return }
        do {
            try await api.register(deviceToken: deviceToken, body)
            lastRegistration = (deviceToken, body)
            lastRegistrationError = nil
        } catch {
            logger.error("Device registration failed: \(error.localizedDescription)")
            lastRegistrationError = error.localizedDescription
        }
    }
}

extension Data {
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
