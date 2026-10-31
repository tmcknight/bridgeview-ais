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
        let largeTitle: [NSAttributedString.Key: Any] = [.font: font(.largeTitle, .heavy)]
        let title: [NSAttributedString.Key: Any] = [.font: font(.headline, .bold)]

        // Set on the bar appearances too: a bar that uses one ignores the plain
        // title attributes, which left the system font on some first launches
        func styled(_ configure: (UINavigationBarAppearance) -> Void) -> UINavigationBarAppearance {
            let appearance = UINavigationBarAppearance()
            configure(appearance)
            appearance.largeTitleTextAttributes = largeTitle
            appearance.titleTextAttributes = title
            return appearance
        }
        let bar = UINavigationBar.appearance()
        bar.largeTitleTextAttributes = largeTitle
        bar.titleTextAttributes = title
        // The system's own backgrounds: material when scrolled, clear at the top
        bar.standardAppearance = styled { $0.configureWithDefaultBackground() }
        bar.compactAppearance = styled { $0.configureWithDefaultBackground() }
        bar.scrollEdgeAppearance = styled { $0.configureWithTransparentBackground() }
        bar.compactScrollEdgeAppearance = styled { $0.configureWithTransparentBackground() }
    }
}
