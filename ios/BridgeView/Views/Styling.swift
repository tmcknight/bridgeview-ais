import SwiftUI

/// The screen background: the river's blue at the top, fading into fog (or
/// night water) with a few faint swells
struct RiverBackground: View {
    var body: some View {
        ZStack(alignment: .top) {
            Theme.background
            LinearGradient(
                colors: [Theme.river.opacity(0.22), Theme.river.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 360)
            Swells()
                .stroke(Theme.shallows.opacity(0.12), lineWidth: 1.2)
                .frame(height: 140)
                .padding(.top, 70)
        }
        .ignoresSafeArea()
    }
}

/// Three gentle, offset waves across the width
private struct Swells: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for line in 0..<3 {
            let y = rect.minY + CGFloat(line) * rect.height / 3 + 12
            let amplitude: CGFloat = 6 - CGFloat(line) * 1.5
            let wavelength = rect.width / (1.6 + CGFloat(line) * 0.4)
            let phase = CGFloat(line) * 0.9
            path.move(to: CGPoint(x: rect.minX, y: y + sin(phase) * amplitude))
            for x in stride(from: rect.minX, through: rect.maxX, by: 4) {
                path.addLine(to: CGPoint(x: x, y: y + sin(x / wavelength * 2 * .pi + phase) * amplitude))
            }
        }
        return path
    }
}

/// A rounded surface with a hairline edge
struct CardModifier: ViewModifier {
    var padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: Theme.cornerRadius))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.cornerRadius)
                    .strokeBorder(Theme.hairline)
            }
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View {
        modifier(CardModifier(padding: padding))
    }

    /// Themed background for a List or Form
    func riverListBackground() -> some View {
        scrollContentBackground(.hidden)
            .background { RiverBackground() }
    }
}

/// Small caps label above a group of cards
struct SectionLabel: View {
    var text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.bold))
            .tracking(1.4)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A figure with a label under it, for the ship page and hero card
struct Stat: View {
    var label: String
    var value: Text

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            value
                .font(Theme.figure(.title3))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(0.8)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
