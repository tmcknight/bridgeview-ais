import SwiftUI

/// Live Activity on or off for one ship coming up; starts out as the user's
/// default from Settings. Hidden while alerts or Live Activities are off.
///
/// Like the Apple Sports app: a button right on the ship, filled in while it's
/// on, rather than a switch. `.menu` is a plain toggle for context menus.
struct LiveActivityToggle: View {
    typealias Key = AlertPreferences.Key

    enum Style {
        /// "Live Activity" in a capsule, for the ship's page
        case pill
        /// Just the symbol in a circle, for list rows and cards
        case icon
        /// A toggle, for context menus
        case menu
    }

    @Environment(PushManager.self) private var push
    @AppStorage(Key.enabled) private var alertsEnabled = true
    @AppStorage(Key.liveActivities) private var byDefault = true
    @AppStorage(Key.liveActivityShips) private var choices = ""

    var mmsi: Int
    var style: Style = .menu

    private static let symbol = "platter.filled.bottom.iphone"

    var body: some View {
        if alertsEnabled && push.liveActivitiesEnabled {
            switch style {
            case .menu:
                Toggle("Live Activity", systemImage: Self.symbol, isOn: isOn)
            case .pill, .icon:
                button
            }
        }
    }

    private var button: some View {
        let on = isOn.wrappedValue
        return Button {
            isOn.wrappedValue.toggle()
        } label: {
            Group {
                if style == .pill {
                    Label("Live Activity", systemImage: on ? "checkmark" : Self.symbol)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                } else {
                    Image(systemName: Self.symbol)
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 34, height: 34)
                }
            }
            .foregroundStyle(on ? Color.white : Color.primary)
            .background {
                Capsule().fill(on ? AnyShapeStyle(Theme.signal.gradient) : AnyShapeStyle(.thinMaterial))
            }
            .contentTransition(.symbolEffect(.replace))
            .animation(.snappy, value: on)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: on)
        .accessibilityLabel("Live Activity")
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityHint(on ? "Stops following this ship on the Lock Screen" : "Follows this ship on the Lock Screen")
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
