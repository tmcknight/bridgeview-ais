import SwiftUI

/// Live Activity on or off for one ship coming up; starts out as the user's
/// default from Settings. Hidden while alerts or Live Activities are off.
///
/// Like the Apple Sports app: a glass capsule with a hairline edge right on the
/// ship, reading "Follow" or "Following", rather than a switch. `.menu` is a plain toggle for context menus.
struct LiveActivityToggle: View {
    typealias Key = AlertPreferences.Key

    enum Style {
        /// "Follow" / "Following" in a capsule, centred, for the ship's page
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
                    HStack(spacing: 8) {
                        symbol(on: on)
                        Text(on ? "Following" : "Follow")
                            .contentTransition(.interpolate)
                    }
                    .font(.headline)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 12)
                } else {
                    symbol(on: on)
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 34, height: 34)
                }
            }
            .foregroundStyle(.primary)
            .glassPill()
            .overlay { Capsule().strokeBorder(Theme.hairline) }
            .contentShape(.capsule)
            .animation(.snappy, value: on)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: style == .pill ? .infinity : nil)
        .sensoryFeedback(.selection, trigger: on)
        .accessibilityLabel("Live Activity")
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityInputLabels(["Live Activity", "Follow", "Following"])
        .accessibilityHint(on ? "Stops following this ship on the Lock Screen" : "Follows this ship on the Lock Screen")
    }

    /// The Live Activity symbol, in the signal colour while it's on
    private func symbol(on: Bool) -> some View {
        Image(systemName: Self.symbol)
            .foregroundStyle(on ? AnyShapeStyle(Theme.signal) : AnyShapeStyle(.primary))
            .symbolEffect(.bounce, value: on)
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
