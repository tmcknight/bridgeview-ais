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
                // Name below the camera, across the whole width, not squeezed beside it
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        ShipName(name: context.attributes.name, style: .subheadline)
                        DetailLine(attributes: context.attributes, state: context.state)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
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
        VStack(alignment: .leading, spacing: 10) {
            // The name on a row of its own, so it has the full width
            HStack(spacing: 10) {
                Image("LogoMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 26, height: 26)
                    .accessibilityHidden(true)
                ShipName(name: attributes.name, style: .headline)
            }
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Label(headline, systemImage: attributes.direction.symbol)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
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

/// The ship's name in hull lettering, shrinking to fit long names on one line
private struct ShipName: View {
    var name: String
    var style: Font.TextStyle

    var body: some View {
        Text(name)
            .font(Theme.hull(style))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
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
        name: "FEDERAL ST. LAURENT",
        direction: .upbound,
        shipTypeName: "Cargo",
        length: 225,
        destination: "THUNDER BAY"
    )
}
