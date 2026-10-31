import SwiftUI

struct ContentView: View {
    @Environment(BridgeStore.self) private var store
    @Environment(PushManager.self) private var push
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage(AlertPreferences.Key.liveActivityShips) private var liveActivityShips = ""

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Coming up", systemImage: "ferry", value: Router.Tab.upcoming) {
                UpcomingView()
            }
            Tab("Map", systemImage: "map", value: Router.Tab.map) {
                LiveMapView()
            }
            Tab("Recent", systemImage: "clock.arrow.circlepath", value: Router.Tab.recent) {
                RecentView()
            }
            Tab("Settings", systemImage: "gearshape", value: Router.Tab.settings) {
                SettingsView()
            }
        }
        // Poll only while the app is in front
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            await push.refreshAuthorization()
            await store.poll()
        }
        // Forget per-ship Live Activity choices once the ship isn't coming up any more
        .onChange(of: store.snapshot?.upcoming.map(\.mmsi)) { _, upcoming in
            guard let upcoming else { return }
            let ships = AlertPreferences.decodeShips(liveActivityShips)
            let kept = ships.filter { upcoming.contains($0.key) }
            guard kept.count != ships.count else { return }
            liveActivityShips = AlertPreferences.encodeShips(kept)
            push.preferencesChanged()
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
