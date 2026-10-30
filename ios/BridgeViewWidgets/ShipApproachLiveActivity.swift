import ActivityKit
import SwiftUI
import WidgetKit

/// Lock Screen and Dynamic Island countdown for a ship heading for the bridge
struct ShipApproachLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShipApproachAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state)
                .padding(16)
                .activityBackgroundTint(Color("RiverBlue").opacity(0.92))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(DeepLink.ship(context.attributes.mmsi))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(context.attributes.direction.label)
                    } icon: {
                        Image(systemName: context.attributes.direction.symbol)
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.signalOnRiver)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(state: context.state)
                        .font(Theme.figure(.title3))
                        .foregroundStyle(Theme.signalOnRiver)
                        .multilineTextAlignment(.trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.name)
                        .font(Theme.hull(.subheadline))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    DetailLine(attributes: context.attributes, state: context.state)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                HStack(spacing: 2) {
                    Image(systemName: "ferry.fill")
                    Image(systemName: context.attributes.direction.symbol)
                        .font(.caption2.weight(.bold))
                }
                .foregroundStyle(Theme.signalOnRiver)
            } compactTrailing: {
                Countdown(state: context.state)
                    .font(Theme.figure(.body))
                    .foregroundStyle(Theme.signalOnRiver)
                    .frame(maxWidth: 52)
                    .multilineTextAlignment(.trailing)
            } minimal: {
                Image(systemName: context.state.phase == .passed ? "checkmark" : "ferry.fill")
                    .foregroundStyle(Theme.signalOnRiver)
            }
            .widgetURL(DeepLink.ship(context.attributes.mmsi))
            .keylineTint(Theme.signalOnRiver)
        }
    }
}

private struct LockScreenView: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image("LogoMark")
                .resizable()
                .scaledToFit()
                .frame(width: 48, height: 48)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(attributes.name)
                    .font(Theme.hull(.headline))
                    .lineLimit(1)
                Label(headline, systemImage: attributes.direction.symbol)
                    .font(.subheadline.weight(.medium))
                DetailLine(attributes: attributes, state: state)
                    .font(.caption)
                    .opacity(0.8)
            }
            Spacer(minLength: 8)
            Countdown(state: state)
                .font(Theme.figure(.title, weight: .heavy))
                .foregroundStyle(Theme.signalOnRiver)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 110, alignment: .trailing)
        }
        .foregroundStyle(.white)
    }

    private var headline: String {
        switch state.phase {
        case .approaching: "\(attributes.direction.label) to the Blue Water Bridge"
        case .passed: "Went under the bridge"
        case .lost: "No longer heading for the bridge"
        }
    }
}

/// Minutes and seconds to the bridge, or how it ended
private struct Countdown: View {
    var state: ShipApproachAttributes.ContentState

    var body: some View {
        switch state.phase {
        case .approaching where state.eta > .now:
            Text(timerInterval: Date.now...state.eta, countsDown: true)
        case .approaching:
            Text("Now")
        case .passed:
            Text("Passed")
        case .lost:
            Text("—")
        }
    }
}

/// "Cargo · 225 m · 1.6 NM · 11.2 kn"
private struct DetailLine: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState

    var body: some View {
        Text(parts.joined(separator: " · "))
            .lineLimit(1)
    }

    private var parts: [String] {
        var parts: [String] = []
        if let type = attributes.shipTypeName { parts.append(type) }
        if let length = attributes.length { parts.append("\(length) m") }
        if state.phase == .approaching {
            parts.append(String(format: "%.1f NM", state.distanceNM))
            parts.append(String(format: "%.1f kn", state.sog))
        } else if let destination = attributes.destination {
            parts.append("to \(destination.capitalized)")
        }
        return parts
    }
}

#Preview("Lock Screen", as: .content, using: ShipApproachAttributes.preview) {
    ShipApproachLiveActivity()
} contentStates: {
    ShipApproachAttributes.ContentState(eta: .now.addingTimeInterval(8 * 60), distanceNM: 1.6, sog: 11.2, phase: .approaching)
    ShipApproachAttributes.ContentState(eta: .now, distanceNM: 0, sog: 11.2, phase: .passed)
}

extension ShipApproachAttributes {
    fileprivate static let preview = ShipApproachAttributes(
        mmsi: 316_001_234,
        name: "ALGOMA EQUINOX",
        direction: .upbound,
        shipTypeName: "Cargo",
        length: 225,
        destination: "THUNDER BAY"
    )
}
