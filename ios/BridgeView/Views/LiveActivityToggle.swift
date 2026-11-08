import SwiftUI

/// Live Activity on or off for one ship coming up, on the ship's page; starts out
/// as the user's default from Settings. Hidden while alerts or Live Activities
/// are off.
///
/// Like the Apple Sports app: a glass capsule with a hairline edge right on the
/// ship, reading "Follow" or "Following", rather than a switch.
struct LiveActivityToggle: View {
    typealias Key = AlertPreferences.Key

    @Environment(PushManager.self) private var push
    @AppStorage(Key.enabled) private var alertsEnabled = true
    @AppStorage(Key.liveActivities) private var byDefault = true
    @AppStorage(Key.liveActivityShips) private var choices = ""

    var mmsi: Int

    /// Apple Sports' symbol for following a game: outlined to follow, filled while following
    private static let symbol = "clock.badge"

    var body: some View {
        if alertsEnabled && push.liveActivitiesEnabled {
            button
        }
    }

    private var button: some View {
        let on = isOn.wrappedValue
        return Button {
            isOn.wrappedValue.toggle()
        } label: {
            HStack(spacing: 8) {
                symbol(on: on)
                Text(on ? "Following" : "Follow")
                    .contentTransition(.interpolate)
            }
            .font(.headline)
            .padding(.horizontal, 22)
            .padding(.vertical, 12)
            .foregroundStyle(.primary)
            .glassPill()
            .overlay { Capsule().strokeBorder(Theme.hairline) }
            .contentShape(.capsule)
            .animation(.snappy, value: on)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .sensoryFeedback(.selection, trigger: on)
        .accessibilityLabel("Live Activity")
        // Read as a switch ("Live Activity, switch button, on"), which is what it is
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityInputLabels(["Live Activity", "Follow", "Following"])
        .accessibilityHint(on ? "Stops following this ship on the Lock Screen" : "Follows this ship on the Lock Screen")
    }

    /// The Live Activity symbol, filled and in the signal colour while it's on
    private func symbol(on: Bool) -> some View {
        Image(systemName: Self.symbol)
            .symbolVariant(on ? .fill : .none)
            .contentTransition(.symbolEffect(.replace))
            .foregroundStyle(on ? AnyShapeStyle(Theme.signal) : AnyShapeStyle(.primary))
    }

    private var isOn: Binding<Bool> {
        Self.isOn(mmsi: mmsi, choices: $choices, byDefault: byDefault, push: push)
    }

    /// Whether one ship gets a Live Activity: its own choice, else the default
    static func isOn(mmsi: Int, choices: Binding<String>, byDefault: Bool, push: PushManager) -> Binding<Bool> {
        Binding {
            AlertPreferences.decodeShips(choices.wrappedValue)[mmsi] ?? byDefault
        } set: { on in
            var ships = AlertPreferences.decodeShips(choices.wrappedValue)
            ships[mmsi] = on
            choices.wrappedValue = AlertPreferences.encodeShips(ships)
            push.preferencesChanged()
        }
    }
}

/// The same choice as a ticked menu item, for pressing and holding a ship in
/// Coming up. No menu while alerts or Live Activities are off.
struct LiveActivityMenu: ViewModifier {
    typealias Key = AlertPreferences.Key

    @Environment(PushManager.self) private var push
    @AppStorage(Key.enabled) private var alertsEnabled = true
    @AppStorage(Key.liveActivities) private var byDefault = true
    @AppStorage(Key.liveActivityShips) private var choices = ""

    var mmsi: Int
    var enabled: Bool

    func body(content: Content) -> some View {
        if enabled && alertsEnabled && push.liveActivitiesEnabled {
            content.contextMenu {
                Toggle(isOn: LiveActivityToggle.isOn(mmsi: mmsi, choices: $choices, byDefault: byDefault, push: push)) {
                    Label("Live Activity", systemImage: "clock.badge")
                }
            }
        } else {
            content
        }
    }
}

extension View {
    /// Press and hold to follow the ship on the Lock Screen without opening it
    func liveActivityMenu(mmsi: Int, if enabled: Bool = true) -> some View {
        modifier(LiveActivityMenu(mmsi: mmsi, enabled: enabled))
    }
}
