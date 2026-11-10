import Foundation

enum Format {
    static func distance(_ nm: Double) -> String {
        nm < 10 ? String(format: "%.1f NM", nm) : String(format: "%.0f NM", nm)
    }

    static func speed(_ knots: Double) -> String {
        String(format: "%.1f kn", knots)
    }

    static func minutes(_ value: Double) -> String {
        let total = Int(value.rounded())
        if total < 1 { return "now" }
        if total < 60 { return "\(total) min" }
        return "\(total / 60) h \(total % 60) min"
    }

    /// "12 minutes", "1 hour, 5 minutes" for VoiceOver, where "12 min" is read letter by letter
    static func spokenMinutes(_ value: Double) -> String {
        let total = Int(value.rounded())
        if total < 1 { return "now" }
        return Duration.seconds(total * 60).formatted(.units(allowed: [.hours, .minutes], width: .wide))
    }

    /// Units in words for VoiceOver, which reads "NM" and "kn" as letters:
    /// "Cargo · 225 × 24 m · 1.6 NM" becomes "Cargo, 225 by 24 metres, 1.6 nautical miles".
    /// Lengths are spelled for the locale ("meters" in the US)
    static func spoken(_ text: String, locale: Locale = Lengths.english) -> String {
        var spoken = text
            .replacingOccurrences(of: " · ", with: ", ")
            .replacingOccurrences(of: " × ", with: " by ")
        let lengths: [(String, UnitLength)] = [("km", .kilometers), ("m", .meters), ("ft", .feet)]
        for (symbol, unit) in lengths {
            spoken = spoken.replacing(try! Regex("(\\d[\\d,]*(?:\\.\\d+)?) \(symbol)\\b")) { match in
                let digits = String(match.output[1].substring ?? "")
                guard let value = Double(digits.replacingOccurrences(of: ",", with: "")) else { return String(match.output[0].substring ?? "") }
                let fraction = digits.split(separator: ".").dropFirst().first?.count ?? 0
                return Measurement(value: value, unit: unit).formatted(
                    .measurement(width: .wide, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(fraction)).locale(locale))
                    .locale(locale)
                )
            }
        }
        for (unit, words) in [("NM", "nautical miles"), ("kn", "knots"), ("kW", "kilowatts"), ("t", "tonnes")] {
            spoken = spoken.replacingOccurrences(of: "(\\d) \(unit)\\b", with: "$1 \(words)", options: .regularExpression)
        }
        return spoken
    }

    /// Which way a ship is heading, for VoiceOver: "heading north-northeast", and with
    /// the phone's compass heading, where that is from the way the phone points
    /// ("30 degrees right of the way you're facing"), to the nearest 10 degrees so it doesn't change
    /// with every twitch of the phone
    static func spokenCourse(_ course: Double, compassHeading: Double? = nil) -> String {
        let points = [
            "north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
            "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest",
        ]
        let degrees = (course.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        let heading = "heading \(points[Int((degrees / 22.5).rounded()) % 16])"
        guard let compassHeading else { return heading }
        let turn = ShipMotion.turn(from: compassHeading, to: course)
        let rounded = Int((abs(turn) / 10).rounded()) * 10
        return switch rounded {
        case ...10: "\(heading), the way you're facing"
        case 170...: "\(heading), opposite the way you're facing"
        default: "\(heading), \(rounded) degrees \(turn > 0 ? "right" : "left") of the way you're facing"
        }
    }

    /// AIS destinations are typed in capitals by the crew; show them in title case
    static func place(_ text: String) -> String {
        text.capitalized
    }
}
