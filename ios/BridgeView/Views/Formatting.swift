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

    /// AIS destinations are typed in capitals by the crew; show them in title case
    static func place(_ text: String) -> String {
        text.capitalized
    }
}
