import SwiftUI

/// Live Activity on or off for one ship coming up; starts out as the user's
/// default from Settings. Hidden while alerts or Live Activities are off.
struct LiveActivityToggle: View {
    typealias Key = AlertPreferences.Key

    @Environment(PushManager.self) private var push
    @AppStorage(Key.enabled) private var alertsEnabled = true
    @AppStorage(Key.liveActivities) private var byDefault = true
    @AppStorage(Key.liveActivityShips) private var choices = ""

    var mmsi: Int

    var body: some View {
        if alertsEnabled && push.liveActivitiesEnabled {
            Toggle("Live Activity", systemImage: "timer", isOn: isOn)
        }
    }

    private var isOn: Binding<Bool> {
        Binding {
            AlertPreferences.decodeShips(choices)[mmsi] ?? byDefault
        } set: { on in
            var ships = AlertPreferences.decodeShips(choices)
            ships[mmsi] = on
            choices = AlertPreferences.encodeShips(ships)
            push.preferencesChanged()
        }
    }
}
