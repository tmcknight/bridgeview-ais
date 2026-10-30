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
    static let hairline = Color(light: 0x0A3C61, lightAlpha: 0.10, dark: 0x8FB8DE, darkAlpha: 0.14)
    /// Deep river blue for headers, the hero card and the Live Activity
    static let river = Color(light: 0x0A3C61, dark: 0x0B2A47)
    /// Lighter blue the river fades to
    static let shallows = Color(light: 0x1A6A9A, dark: 0x134770)
    /// International orange, like the paint on navigation marks; the app's tint
    static let signal = Color(light: 0xD9530F, dark: 0xFF8A3D)
    /// Signal orange that reads on the river blue in either mode
    static let signalOnRiver = Color(hex: 0xFF9A52)
    static let upbound = Color(light: 0x0B8A7A, dark: 0x34D2BC)
    static let downbound = Color(light: 0x4651C8, dark: 0x8F98FF)

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

    /// A colour that follows the interface style (and the app's appearance setting)
    init(light: UInt32, lightAlpha: Double = 1, dark: UInt32, darkAlpha: Double = 1) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(Color(hex: dark, alpha: darkAlpha))
                : UIColor(Color(hex: light, alpha: lightAlpha))
        })
    }
}
