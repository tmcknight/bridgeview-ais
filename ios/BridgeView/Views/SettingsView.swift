import SwiftUI
import UserNotifications

/// Which ships to be alerted about, and the state of notifications and Live Activities
struct SettingsView: View {
    typealias Key = AlertPreferences.Key

    @Environment(PushManager.self) private var push
    @Environment(BridgeStore.self) private var store
    @Environment(NearBridgeMonitor.self) private var nearBridge
    @Environment(\.openURL) private var openURL

    @AppStorage(Key.enabled) private var enabled = true
    @AppStorage(Key.categories) private var categories = AlertPreferences.defaultCategories
    @AppStorage(Key.minLength) private var minLength = 0
    @AppStorage(Key.directions) private var directions = AlertPreferences.defaultDirections
    @AppStorage(Key.nearBridgeOnly) private var nearBridgeOnly = false
    @AppStorage(Key.nearBridgeRadius) private var nearBridgeRadius = AlertPreferences.defaultRadius
    @AppStorage(Appearance.key) private var appearance = Appearance.system

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Bridge alerts", isOn: $enabled)
                } footer: {
                    Text("Get a notification when a ship is about 5–10 minutes from the \(Bridge.name).")
                }
                .listRowBackground(Theme.surface)
                if push.authorization == .denied {
                    Section {
                        Button("Turn on notifications in Settings") { openSettings() }
                    } footer: {
                        Text("Notifications are off for BridgeView, so alerts can't reach this phone.")
                    }
                    .listRowBackground(Theme.surface)
                }
                if enabled {
                    Section("Ships") {
                        ForEach(ShipCategory.allCases, id: \.self) { category in
                            Toggle(category.label, isOn: binding(category, in: $categories))
                        }
                        Picker("Length", selection: $minLength) {
                            ForEach(AlertPreferences.lengthOptions, id: \.self) { length in
                                Text(length == 0 ? "Any" : "\(length) m or more").tag(length)
                            }
                        }
                    }
                    .listRowBackground(Theme.surface)
                    Section("Direction") {
                        ForEach(Direction.allCases, id: \.self) { direction in
                            Toggle(isOn: binding(direction, in: $directions)) {
                                Label {
                                    Text(direction == .upbound ? "Upbound (to Lake Huron)" : "Downbound (to Lake St. Clair)")
                                } icon: {
                                    Image(systemName: direction.symbol)
                                        .fontWeight(.heavy)
                                        .foregroundStyle(Theme.color(for: direction))
                                }
                            }
                        }
                    }
                    .listRowBackground(Theme.surface)
                    Section {
                        Toggle("Only when I'm near the bridge", isOn: $nearBridgeOnly)
                        if nearBridgeOnly {
                            Picker("Within", selection: $nearBridgeRadius) {
                                ForEach(AlertPreferences.radiusOptions, id: \.self) { km in
                                    Text("\(km) km").tag(km)
                                }
                            }
                            nearBridgeStatus
                        }
                    } header: {
                        Text("Where you are")
                    } footer: {
                        Text("Alerts pause while you're farther from the bridge and start again when you come back. Your location stays on this phone; BridgeView only tells the server whether to send alerts.")
                    }
                    .listRowBackground(Theme.surface)
                    Section {
                        LabeledContent("Live Activities", value: push.liveActivitiesEnabled ? "On" : "Off")
                        if !push.liveActivitiesEnabled {
                            Button("Turn on in Settings") { openSettings() }
                        }
                    } footer: {
                        Text("With Live Activities on, an alert also puts a countdown on your Lock Screen and in the Dynamic Island until the ship goes under the bridge.")
                    }
                    .listRowBackground(Theme.surface)
                }
                Section {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(Appearance.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                } header: {
                    Text("Appearance")
                } footer: {
                    Text("System follows your iPhone's Light or Dark setting.")
                }
                if let error = push.lastRegistrationError {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                    } header: {
                        Text("Couldn't register for alerts")
                    }
                    .listRowBackground(Theme.surface)
                }
                Section {
                    Text("BridgeView is a gift to the Sarnia and Port Huron communities, for everyone who loves watching the ships go by.")
                        .font(.footnote)
                    Text("Ship positions come from AIS, the radio beacons ships broadcast, received by a local antenna and the feeds credited below. Arrival times are estimates from each ship's speed and course. Photos and ship details from Wikidata and Wikimedia Commons, under their contributors' licences.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let attribution = store.snapshot?.attribution, !attribution.isEmpty {
                        DataCredits(attribution: attribution)
                    }
                    Link("About BridgeView", destination: AppConfig.apiURL.appending(path: "about.html"))
                    Link("Terms", destination: AppConfig.apiURL.appending(path: "terms.html"))
                    Link("Privacy", destination: AppConfig.apiURL.appending(path: "privacy.html"))
                } header: {
                    Text("About")
                } footer: {
                    Text("BridgeView is for watching ships. Don't use it for navigation or safety.")
                }
                .listRowBackground(Theme.surface)
            }
            .riverListBackground()
            // The title sits in the bar now; no need for the form's usual top gap
            .contentMargins(.top, 4, for: .scrollContent)
            .navigationTitle("Settings")
            // Big title in the bar, beside its buttons, not on a row of its own
            .toolbarTitleDisplayMode(.inlineLarge)
            .onChange(of: enabled) { locationSettingsChanged() }
            .onChange(of: categories) { push.preferencesChanged() }
            .onChange(of: minLength) { push.preferencesChanged() }
            .onChange(of: directions) { push.preferencesChanged() }
            .onChange(of: nearBridgeOnly) { locationSettingsChanged() }
            .onChange(of: nearBridgeRadius) { locationSettingsChanged() }
        }
    }

    private func binding<T: RawRepresentable & CaseIterable & Hashable>(
        _ value: T,
        in storage: Binding<String>
    ) -> Binding<Bool> where T.RawValue == String {
        Binding {
            let set: Set<T> = AlertPreferences.decodeSet(storage.wrappedValue)
            return set.contains(value)
        } set: { isOn in
            var set: Set<T> = AlertPreferences.decodeSet(storage.wrappedValue)
            if isOn { set.insert(value) } else { set.remove(value) }
            storage.wrappedValue = AlertPreferences.encodeSet(set)
        }
    }

    @ViewBuilder private var nearBridgeStatus: some View {
        switch nearBridge.authorization {
        case .denied, .restricted:
            Label("Location is off for BridgeView, so alerts aren't paused", systemImage: "location.slash")
                .foregroundStyle(.secondary)
            Button("Turn on in Settings") { openSettings() }
        case .authorizedWhenInUse:
            Label("Allow location access \u{201C}Always\u{201D} so alerts can pause when you leave", systemImage: "location")
                .foregroundStyle(.secondary)
            Button("Change in Settings") { openSettings() }
        case .authorizedAlways:
            switch nearBridge.isNear {
            case true?:
                Label("You're near the bridge", systemImage: "location.fill")
                    .foregroundStyle(Theme.upbound)
            case false?:
                Label("You're away, so alerts are paused", systemImage: "pause.circle.fill")
                    .foregroundStyle(.secondary)
            case nil:
                Label("Finding where you are…", systemImage: "location")
                    .foregroundStyle(.secondary)
            }
        default:
            EmptyView()
        }
    }

    private func locationSettingsChanged() {
        Task { await nearBridge.update(.load()) }
        push.preferencesChanged()
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }
}
