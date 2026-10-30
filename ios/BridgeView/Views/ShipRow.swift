import SwiftUI

/// One ship in the "Coming up" or "Passed" list
struct ShipRow: View {
    enum Mode {
        case upcoming, recent
    }

    var ship: Ship
    var mode: Mode

    var body: some View {
        HStack(spacing: 12) {
            DirectionBadge(direction: direction, course: mode == .upcoming ? ship.position?.course : nil)
            VStack(alignment: .leading, spacing: 2) {
                Text(ship.name)
                    .font(Theme.hull(.subheadline))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                if !details.isEmpty {
                    Text(details)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            trailing
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
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
        switch mode {
        case .upcoming:
            if let approach = ship.approach {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Format.minutes(approach.etaMinutes))
                        .font(Theme.figure(.subheadline))
                        .foregroundStyle(Theme.signal)
                        .multilineTextAlignment(.trailing)
                    Text(approach.eta, style: .time)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        case .recent:
            if let passage = ship.lastPassage {
                VStack(alignment: .trailing, spacing: 2) {
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

    var body: some View {
        let color = Theme.color(for: direction)
        DirectionArrow(direction: direction, course: course)
            .font(.body.weight(.heavy))
            .foregroundStyle(.white)
            .frame(width: 38, height: 38)
            .background {
                RoundedRectangle(cornerRadius: 11)
                    .fill(color.gradient)
            }
            .accessibilityLabel(direction?.label ?? "Ship")
    }
}

/// Up or down arrow, or with a course, an arrow pointing along it (north up)
struct DirectionArrow: View {
    var direction: Direction?
    var course: Double?

    var body: some View {
        if let course, direction != nil {
            Image(systemName: "arrow.up")
                .rotationEffect(.degrees(course))
        } else {
            Image(systemName: direction?.symbol ?? "ferry")
        }
    }
}
