import SwiftUI

/// One ship in the "Coming up" or "Recent" list
struct ShipRow: View {
    enum Mode {
        case upcoming, recent
    }

    var ship: Ship
    var mode: Mode

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        // At accessibility text sizes the figures go under the name, so neither is squeezed
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            DirectionBadge(
                direction: direction,
                course: mode == .upcoming ? ship.position?.course : nil,
                followsCompass: mode == .upcoming
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(ship.name)
                    .font(Theme.hull(.subheadline))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                    .minimumScaleFactor(0.75)
                if !details.isEmpty {
                    Text(details)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                }
            }
            if !dynamicTypeSize.isAccessibilitySize {
                Spacer(minLength: 8)
            }
            trailing
            if !dynamicTypeSize.isAccessibilitySize {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        // One element, read in a sensible order with units in words, rather than
        // the badge, name, "1.6 NM", "12 min" and the time as separate fragments
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ship.name)
        .accessibilityValue(accessibilityDetails)
        .accessibilityInputLabels([ship.name])
    }

    /// "Upbound, heading north-northeast. Cargo, 225 metres. 1.6 nautical miles
    /// away, in 12 minutes, at 3:45 PM"
    private var accessibilityDetails: String {
        var sentences: [String] = []
        if let direction {
            var heading = direction.label
            if mode == .upcoming, let course = ship.position?.course {
                heading += ", \(Format.spokenCourse(course))"
            }
            sentences.append(heading)
        }
        if !ship.summary.isEmpty { sentences.append(Format.spoken(ship.summary)) }
        switch mode {
        case .upcoming:
            if let approach = ship.approach {
                let time = approach.eta.formatted(date: .omitted, time: .shortened)
                sentences.append(
                    "\(Format.spoken(Format.distance(approach.distanceNM))) away, "
                        + (approach.etaMinutes < 0.5 ? "at the bridge now" : "in \(Format.spokenMinutes(approach.etaMinutes)), at \(time)")
                )
            }
        case .recent:
            if let passage = ship.lastPassage {
                let relative = passage.time.formatted(.relative(presentation: .named))
                let time = passage.time.formatted(date: .omitted, time: .shortened)
                sentences.append("Passed \(relative), at \(time)")
            }
        }
        return sentences.joined(separator: ". ")
    }

    private var direction: Direction? {
        mode == .upcoming ? ship.approach?.direction : ship.lastPassage?.direction
    }

    private var details: String {
        var parts = [ship.summary].filter { !$0.isEmpty }
        if mode == .upcoming, let approach = ship.approach {
            parts.append(Format.distance(approach.distanceNM))
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private var trailing: some View {
        let alignment: HorizontalAlignment = dynamicTypeSize.isAccessibilitySize ? .leading : .trailing
        switch mode {
        case .upcoming:
            if let approach = ship.approach {
                VStack(alignment: alignment, spacing: 2) {
                    Text(Format.minutes(approach.etaMinutes))
                        .font(Theme.figure(.subheadline))
                        .foregroundStyle(Theme.signal)
                        .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
                    Text(approach.eta, style: .time)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        case .recent:
            if let passage = ship.lastPassage {
                VStack(alignment: alignment, spacing: 2) {
                    Text(passage.time, format: .relative(presentation: .named))
                        .font(Theme.figure(.subheadline, weight: .semibold))
                    Text(passage.time, style: .time)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// Arrow for a ship's direction through the river, pointing the way the ship is
/// heading when its course is known (straight up or down otherwise)
struct DirectionBadge: View {
    var direction: Direction?
    var course: Double?
    var followsCompass = true

    /// Grows with the text size, so the arrow (which follows it) isn't clipped
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 38
    @Environment(Compass.self) private var environmentCompass: Compass?

    var body: some View {
        let color = Theme.color(for: direction)
        DirectionArrow(direction: direction, course: course, followsCompass: followsCompass)
            .font(.body.weight(.heavy))
            .foregroundStyle(Theme.onAccent)
            .frame(width: size, height: size)
            .background {
                RoundedRectangle(cornerRadius: 11)
                    .fill(color.gradient)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(direction?.label ?? "Ship")
            .accessibilityValue(courseDescription)
    }

    /// "heading north, 30 degrees right of the way you're facing" when the arrow
    /// follows the ship's course (and the compass)
    private var courseDescription: String {
        guard direction != nil, let course else { return "" }
        return Format.spokenCourse(course, compassHeading: followsCompass ? environmentCompass?.heading : nil)
    }
}

/// Arrow pointing along a ship's course (or its direction through the river),
/// turned by the phone's compass heading like a compass needle, so it points the
/// way the ship is going as seen by whoever holds the phone (north up without one).
/// Ships that have already gone by keep a plain up or down arrow
struct DirectionArrow: View {
    var direction: Direction?
    var course: Double?
    var followsCompass = true

    @Environment(Compass.self) private var environmentCompass: Compass?
    private var compass: Compass? { followsCompass ? environmentCompass : nil }

    var body: some View {
        if let direction {
            Image(systemName: "arrow.up")
                .rotationEffect(.degrees((course ?? direction.bearing) - (compass?.heading ?? 0)))
                .animation(.easeOut(duration: 0.2), value: compass?.heading)
                .onAppear { compass?.start() }
                .onDisappear { compass?.stop() }
        } else {
            Image(systemName: "ferry")
        }
    }
}

private extension Direction {
    /// Roughly which way the river runs at the bridge
    var bearing: Double {
        switch self {
        case .upbound: 0
        case .downbound: 180
        }
    }
}
