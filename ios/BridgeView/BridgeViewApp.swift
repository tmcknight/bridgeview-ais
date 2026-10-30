import SwiftUI
import UIKit

@main
struct BridgeViewApp: App {
    @UIApplicationDelegateAdaptor private var appDelegate: AppDelegate
    @State private var store = BridgeStore()
    @AppStorage(Appearance.key) private var appearance = Appearance.system

    init() {
        Self.styleNavigationTitles()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(store)
                .environment(appDelegate.push)
                .environment(appDelegate.nearBridge)
                .environment(appDelegate.router)
                .tint(Theme.signal)
                .preferredColorScheme(appearance.colorScheme)
                .task { await appDelegate.push.start() }
                .onOpenURL { url in
                    if let mmsi = DeepLink.mmsi(from: url) { appDelegate.router.open(mmsi: mmsi) }
                }
        }
    }

    /// Navigation titles in the wide hull lettering used for ship names
    private static func styleNavigationTitles() {
        func font(_ style: UIFont.TextStyle, _ weight: UIFont.Weight) -> UIFont {
            let size = UIFont.preferredFont(forTextStyle: style).pointSize
            let base = UIFont.systemFont(ofSize: size, weight: weight, width: .expanded)
            return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
        }
        let appearance = UINavigationBar.appearance()
        appearance.largeTitleTextAttributes = [.font: font(.largeTitle, .heavy)]
        appearance.titleTextAttributes = [.font: font(.headline, .bold)]
    }
}
