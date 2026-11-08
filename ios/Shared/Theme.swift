import SwiftUI
import UIKit

/// BridgeView's look: river navy, international-orange signal accent, and ship
/// names set wide like hull lettering. Shared by the app and the Live Activity.
enum Theme {
    // MARK: Colours (each adapts to light and dark)

    /// Screen background: harbour fog by day, the river at night
    static let background = Color(light: 0xEDF2F5, dark: 0x07121D)
    /// Cards and grouped rows
    static let surface = Color(light: 0xFFFFFF, dark: 0x0F2133)
    /// Dividers and card outlines
    static let hairline = Color(
        light: 0x0A3C61, lightAlpha: 0.10, dark: 0x8FB8DE, darkAlpha: 0.14,
        increasedContrast: Color(light: 0x0A3C61, lightAlpha: 0.45, dark: 0x8FB8DE, darkAlpha: 0.5)
    )
    /// Deep river blue for headers, the hero card and the Live Activity
    static let river = Color(light: 0x0A3C61, dark: 0x0B2A47)
    /// Lighter blue the river fades to
    static let shallows = Color(light: 0x1A6A9A, dark: 0x134770)
    /// International orange, like the paint on navigation marks; the app's tint.
    /// At least 4.5:1 on `surface` and `background` in either mode, for small text
    static let signal = Color(
        light: 0xC2410C, dark: 0xFF8A3D,
        increasedContrast: Color(light: 0xB04209, dark: 0xFFA466)
    )
    /// Signal orange that reads on the river blue in either mode
    static let signalOnRiver = Color(
        light: 0xFF9A52, dark: 0xFF9A52,
        increasedContrast: Color(hex: 0xFFC59A)
    )
    static let upbound = Color(
        light: 0x08776A, dark: 0x34D2BC,
        increasedContrast: Color(light: 0x06695D, dark: 0x5EE6D2)
    )
    static let downbound = Color(
        light: 0x4651C8, dark: 0x8F98FF,
        increasedContrast: Color(light: 0x3A43A8, dark: 0xADB3FF)
    )
    /// Symbols on a signal or direction colour: white by day, night water in dark
    /// mode, where the colours are too light for white to stand out
    static let onAccent = Color(light: 0xFFFFFF, dark: 0x07121D)

    static func color(for direction: Direction?) -> Color {
        switch direction {
        case .upbound: upbound
        case .downbound: downbound
        case nil: .gray
        }
    }

    // MARK: Type

    /// Ship names, wide and heavy like the lettering on a hull
    static func hull(_ style: Font.TextStyle, weight: Font.Weight = .heavy) -> Font {
        .system(style, weight: weight).width(.expanded)
    }

    /// Countdowns and figures: rounded, with digits that don't jump about
    static func figure(_ style: Font.TextStyle, weight: Font.Weight = .bold) -> Font {
        .system(style, design: .rounded, weight: weight).monospacedDigit()
    }

    static let cornerRadius: CGFloat = 18
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    /// A colour that follows the interface style (and the app's appearance setting),
    /// and Increase Contrast when `increasedContrast` is given
    init(light: UInt32, lightAlpha: Double = 1, dark: UInt32, darkAlpha: Double = 1, increasedContrast: Color? = nil) {
        self.init(uiColor: UIColor { traits in
            if traits.accessibilityContrast == .high, let increasedContrast {
                return UIColor(increasedContrast).resolvedColor(with: traits)
            }
            return traits.userInterfaceStyle == .dark
                ? UIColor(Color(hex: dark, alpha: darkAlpha))
                : UIColor(Color(hex: light, alpha: lightAlpha))
        })
    }
}
