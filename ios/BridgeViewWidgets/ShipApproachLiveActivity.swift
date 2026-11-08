import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// Lock Screen and Dynamic Island countdown for a ship heading for the bridge,
/// with a small layout for the Apple Watch Smart Stack and CarPlay
struct ShipApproachLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShipApproachAttributes.self) { context in
            ActivityContent(attributes: context.attributes, state: context.state, isStale: context.isStale)
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
                        .opacity(context.isStale ? 0.5 : 1)
                        .multilineTextAlignment(.trailing)
                }
                // Name below the camera, across the whole width, not squeezed beside it
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        ShipName(name: context.attributes.name, style: .subheadline)
                        StatusLine(attributes: context.attributes, state: context.state, isStale: context.isStale)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ApproachProgress(attributes: context.attributes, state: context.state)
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
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(context.attributes.name), \(context.attributes.direction.label)")
            } compactTrailing: {
                Countdown(state: context.state, compact: true)
                    .font(Theme.figure(.body))
                    .foregroundStyle(Theme.signalOnRiver)
                    .opacity(context.isStale ? 0.5 : 1)
                    .frame(maxWidth: 52)
                    .multilineTextAlignment(.trailing)
            } minimal: {
                MinimalView(attributes: context.attributes, state: context.state)
            }
            .widgetURL(DeepLink.ship(context.attributes.mmsi))
            .keylineTint(Theme.signalOnRiver)
        }
        .supplementalActivityFamilies([.small])
    }
}

/// The Lock Screen layout, or the small one where the system asks for it
private struct ActivityContent: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState
    var isStale: Bool
    @Environment(\.activityFamily) private var family

    var body: some View {
        switch family {
        case .small:
            SmallView(attributes: attributes, state: state, isStale: isStale)
                .padding(10)
        default:
            // Less padding while it has its progress bar and buttons: the Lock Screen
            // cuts a Live Activity off at 160 points
            LockScreenView(attributes: attributes, state: state, isStale: isStale)
                .padding(state.phase == .approaching ? 14 : 16)
        }
    }
}

private struct LockScreenView: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState
    var isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: state.phase == .approaching ? 8 : 10) {
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
                    Label(headline, systemImage: headlineSymbol)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    StatusLine(attributes: attributes, state: state, isStale: isStale)
                        .font(.caption)
                        .opacity(0.8)
                }
                Spacer(minLength: 8)
                Countdown(state: state)
                    .font(Theme.figure(.title, weight: .heavy))
                    .foregroundStyle(Theme.signalOnRiver)
                    .opacity(isStale ? 0.5 : 1)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 110, alignment: .trailing)
            }
            if state.phase == .approaching {
                ApproachProgress(attributes: attributes, state: state)
                Actions(mmsi: attributes.mmsi)
            }
        }
        .foregroundStyle(.white)
    }

    private var headline: String {
        switch state.phase {
        // Short enough to fit beside the countdown without being cut off
        case .approaching: "\(attributes.direction.label) to the bridge"
        case .passed:
            if let passedAt = state.passedAt {
                "Went under at \(passedAt.formatted(date: .omitted, time: .shortened))"
            } else {
                "Went under the bridge"
            }
        case .lost: "No longer heading for the bridge"
        }
    }

    private var headlineSymbol: String {
        switch state.phase {
        case .approaching: attributes.direction.symbol
        case .passed: "checkmark.circle"
        case .lost: "xmark.circle"
        }
    }
}

/// Apple Watch Smart Stack and CarPlay: name, direction and countdown
private struct SmallView: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState
    var isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: state.phase == .approaching ? attributes.direction.symbol : "ferry.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Theme.signalOnRiver)
                    .accessibilityHidden(true)
                ShipName(name: attributes.name, style: .caption)
            }
            Countdown(state: state)
                .font(Theme.figure(.title2, weight: .heavy))
                .foregroundStyle(Theme.signalOnRiver)
                .opacity(isStale ? 0.5 : 1)
            if state.phase == .approaching {
                ApproachProgress(attributes: attributes, state: state)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MinimalView: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState

    var body: some View {
        switch state.phase {
        case .approaching:
            Image(systemName: "ferry.fill")
                .foregroundStyle(Theme.signalOnRiver)
                .accessibilityLabel("\(attributes.name) heading for the bridge")
        case .passed:
            Image(systemName: "checkmark")
                .foregroundStyle(Theme.signalOnRiver)
                .accessibilityLabel("\(attributes.name) went under the bridge")
        case .lost:
            Image(systemName: "xmark")
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(attributes.name) no longer heading for the bridge")
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
    /// The Dynamic Island's compact trailing side: room for a few characters
    var compact = false

    var body: some View {
        switch state.phase {
        case .approaching where state.eta > .now:
            Text(timerInterval: Date.now...state.eta, countsDown: true)
        case .approaching:
            // Past the ETA and not yet logged as through: it's at the bridge.
            // One line, shrunk: wrapped, it would push the Live Activity past
            // the Lock Screen's height limit
            Text(compact ? "Now" : "Any moment")
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .accessibilityLabel("Any moment now")
        case .passed:
            Text("Passed")
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        case .lost:
            Text("—")
                .accessibilityLabel("No longer heading for the bridge")
        }
    }
}

/// How far along the countdown is, filling as the ship nears the bridge; moves on
/// its own between updates
private struct ApproachProgress: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState

    var body: some View {
        if state.phase == .approaching, let startedAt = attributes.startedAt, startedAt < state.eta {
            ProgressView(timerInterval: startedAt...state.eta, countsDown: false) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .progressViewStyle(.linear)
            .tint(Theme.signalOnRiver)
            .accessibilityLabel("Progress to the bridge")
        }
    }
}

/// Buttons under the countdown: the ship on the map, the ship cam, and stop following
private struct Actions: View {
    var mmsi: Int

    var body: some View {
        HStack(spacing: 8) {
            Link(destination: DeepLink.map(mmsi)) {
                ActionLabel(title: "Map", symbol: "map")
            }
            .accessibilityLabel("Show on the map")
            Link(destination: DeepLink.cam) {
                ActionLabel(title: "Ship cam", symbol: "video")
            }
            .accessibilityLabel("Watch the ship cam")
            Spacer(minLength: 0)
            Button(intent: StopFollowingIntent(mmsi: mmsi)) {
                ActionLabel(title: "Stop", symbol: "bell.slash")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop following this ship")
        }
        .font(.caption.weight(.semibold))
    }
}

private struct ActionLabel: View {
    var title: String
    var symbol: String

    var body: some View {
        Label(title, systemImage: symbol)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.white.opacity(0.15), in: .capsule)
    }
}

/// "Cargo · 225 m · 1.6 NM · 11.2 kn", the last update's time once it's out of
/// date, or the next ship once this one has gone under
private struct StatusLine: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState
    var isStale: Bool

    var body: some View {
        if isStale && state.phase == .approaching {
            Group {
                if let updatedAt = state.updatedAt {
                    Text("Last update at \(updatedAt, style: .time)")
                } else {
                    Text("Waiting for an update")
                }
            }
            .lineLimit(1)
        } else if state.phase == .passed, let nextName = state.nextName, let nextEta = state.nextEta {
            Text("Next: \(nextName) at \(nextEta, style: .time)")
                .lineLimit(1)
        } else {
            DetailLine(attributes: attributes, state: state)
        }
    }
}

private struct DetailLine: View {
    var attributes: ShipApproachAttributes
    var state: ShipApproachAttributes.ContentState

    var body: some View {
        Text(parts(spoken: false).joined(separator: " · "))
            .lineLimit(1)
            // Units in words: VoiceOver reads "NM" and "kn" as letters
            .accessibilityLabel(parts(spoken: true).joined(separator: ", "))
    }

    private func parts(spoken: Bool) -> [String] {
        var parts: [String] = []
        if let type = attributes.shipTypeName { parts.append(type) }
        if let length = attributes.length { parts.append(spoken ? "\(length) metres" : "\(length) m") }
        if state.phase == .approaching {
            parts.append(String(format: spoken ? "%.1f nautical miles away" : "%.1f NM", state.distanceNM))
            parts.append(String(format: spoken ? "%.1f knots" : "%.1f kn", state.sog))
        } else if let destination = attributes.destination {
            parts.append("to \(destination.capitalized)")
        }
        return parts
    }
}

#Preview("Lock Screen", as: .content, using: ShipApproachAttributes.preview) {
    ShipApproachLiveActivity()
} contentStates: {
    ShipApproachAttributes.ContentState(eta: .now.addingTimeInterval(8 * 60), distanceNM: 1.6, sog: 11.2, phase: .approaching, updatedAt: .now)
    ShipApproachAttributes.ContentState(
        eta: .now, distanceNM: 0, sog: 11.2, phase: .passed, updatedAt: .now,
        passedAt: .now, nextName: "MANITOULIN", nextEta: .now.addingTimeInterval(25 * 60)
    )
    ShipApproachAttributes.ContentState(eta: .now, distanceNM: 0, sog: 0, phase: .lost)
}

extension ShipApproachAttributes {
    fileprivate static let preview = ShipApproachAttributes(
        mmsi: 316_001_234,
        name: "FEDERAL ST. LAURENT",
        direction: .upbound,
        shipTypeName: "Cargo",
        length: 225,
        destination: "THUNDER BAY",
        startedAt: .now.addingTimeInterval(-4 * 60)
    )
}
