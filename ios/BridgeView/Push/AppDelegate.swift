import UIKit
import UserNotifications

/// Receives the APNs token and notification taps, which SwiftUI has no hooks for
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let nearBridge: NearBridgeMonitor
    let push: PushManager
    let router = Router()

    override init() {
        nearBridge = NearBridgeMonitor()
        push = PushManager(nearBridge: nearBridge)
        super.init()
        nearBridge.onChange = { [push] in push.nearBridgeChanged() }
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // iOS may launch the app in the background for a near-the-bridge crossing:
        // pick the monitor back up, and get the device token to send the change with
        Task { await nearBridge.update(.load()) }
        application.registerForRemoteNotifications()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        push.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        push.didFailToRegister(error)
    }

    // Show bridge alerts even while the app is open
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        let mmsi = (userInfo["mmsi"] as? Int) ?? (userInfo["mmsi"] as? NSNumber)?.intValue
        guard let mmsi else { return }
        await MainActor.run { router.open(mmsi: mmsi) }
    }
}
