import SwiftUI

struct ContentView: View {
    @Environment(BridgeStore.self) private var store
    @Environment(PushManager.self) private var push
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(Appearance.key) private var appearance = Appearance.system

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Coming up", systemImage: "ferry", value: Router.Tab.upcoming) {
                UpcomingView()
            }
            Tab("Passed", systemImage: "clock.arrow.circlepath", value: Router.Tab.recent) {
                RecentView()
            }
            Tab("Settings", systemImage: "bell.badge", value: Router.Tab.settings) {
                SettingsView()
            }
        }
        // Poll only while the app is in front
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            await push.refreshAuthorization()
            await store.poll()
        }
        .sheet(item: $router.openedShip) { link in
            NavigationStack {
                ShipDetailView(mmsi: link.mmsi)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { router.openedShip = nil }
                        }
                    }
            }
            // A sheet is its own presentation, so it needs the setting too
            .preferredColorScheme(appearance.colorScheme)
        }
    }
}
