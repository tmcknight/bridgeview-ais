import Foundation

/// The Settings choice of units for ship lengths and distances. Automatic follows
/// the phone's measurement system: feet and miles in the US, metres and kilometres
/// elsewhere. AIS reports lengths in metres, and
/// that's what's stored and sent to the server (`minLength`)
enum LengthUnit: String, CaseIterable, Identifiable, Sendable {
    case automatic
    case metres
    case feet

    static let key = "lengthUnit"

    var id: Self { self }

    var label: LocalizedStringResource {
        switch self {
        case .automatic: "Automatic"
        case .metres: "Metric"
        case .feet: "US"
        }
    }

    /// The setting, as saved. The widget can't see the app's settings, so it's
    /// always automatic there
    static var current: LengthUnit {
        UserDefaults.standard.string(forKey: key).flatMap(LengthUnit.init) ?? .automatic
    }

    func resolved(for locale: Locale = Lengths.english) -> UnitLength {
        switch self {
        case .metres: .meters
        case .feet: .feet
        case .automatic: locale.measurementSystem == .us ? .feet : .meters
        }
    }

    /// For the server's device registration: "m" or "ft"
    func serverValue(for locale: Locale = Lengths.english) -> String {
        resolved(for: locale) == .feet ? "ft" : "m"
    }
}

/// Ship lengths, widths and draughts (given in metres) in the chosen unit, spelled
/// for the phone's locale ("225 m", "738 ft"; spoken "225 metres", "225 meters", "738 feet")
enum Lengths {
    /// English with the phone's region, for formatting: the app is in English, so a
    /// French-Canadian phone gets "225 metres", not "225 mètres", inside English text
    static var english: Locale { english(for: .current) }

    static func english(for locale: Locale) -> Locale {
        Locale(languageCode: .english, languageRegion: locale.region ?? .canada)
    }

    static func format(
        _ metres: Double,
        unit: UnitLength = LengthUnit.current.resolved(),
        decimals: Int = 0,
        spoken: Bool = false,
        locale: Locale = Lengths.english
    ) -> String {
        let value = Measurement(value: metres, unit: UnitLength.meters).converted(to: unit)
        // Feet are small enough that a decimal adds nothing
        let digits = unit == .feet ? 0 : decimals
        return value.formatted(
            .measurement(
                width: spoken ? .wide : .abbreviated,
                usage: .asProvided,
                numberFormatStyle: .number.precision(.fractionLength(digits)).locale(locale)
            )
            .locale(locale)
        )
    }

    static func format(_ metres: Int, unit: UnitLength = LengthUnit.current.resolved(), spoken: Bool = false, locale: Locale = Lengths.english) -> String {
        format(Double(metres), unit: unit, spoken: spoken, locale: locale)
    }

    /// "225 × 24 m", "738 × 79 ft"
    static func size(length: Int, width: Int, unit: UnitLength = LengthUnit.current.resolved(), locale: Locale = Lengths.english) -> String {
        let converted = Measurement(value: Double(length), unit: UnitLength.meters).converted(to: unit).value
        let number = converted.formatted(.number.precision(.fractionLength(0)).locale(locale))
        return "\(number) × \(format(width, unit: unit, locale: locale))"
    }
}

/// How far from the bridge "near" reaches, for pausing alerts while away. Stored in
/// metres; offered in kilometres or, with US units, miles. A value saved under the
/// other system snaps to the nearest choice in this one, and that's what's used
enum NearBridgeRadius {
    static let key = "alerts.nearBridgeRadiusMetres"
    /// Whole kilometres, before the radius was stored in metres
    static let legacyKey = "alerts.nearBridgeRadius"
    static let defaultMetres = 5_000

    static let metricOptions = [2_000, 5_000, 10_000, 25_000]
    static let usOptions = [1.0, 3, 5, 15].map { Int(($0 * 1_609.344).rounded()) }

    static func options(for unit: UnitLength) -> [Int] {
        unit == .feet ? usOptions : metricOptions
    }

    /// The saved radius in metres, from the old kilometre setting if that's all there is
    static func stored(in defaults: UserDefaults = .standard) -> Int {
        if let metres = defaults.object(forKey: key) as? Int { return metres }
        if let km = defaults.object(forKey: legacyKey) as? Int { return km * 1_000 }
        return defaultMetres
    }

    /// The choice closest to `metres` in this unit system
    static func nearest(_ metres: Int, unit: UnitLength) -> Int {
        options(for: unit).min { abs($0 - metres) < abs($1 - metres) } ?? defaultMetres
    }

    /// "5 km" or "3 mi"
    static func label(_ metres: Int, unit: UnitLength, locale: Locale = Lengths.english) -> String {
        let distance = Measurement(value: Double(metres), unit: UnitLength.meters)
            .converted(to: unit == .feet ? .miles : .kilometers)
        return distance.formatted(
            .measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(0)).locale(locale))
            .locale(locale)
        )
    }
}
