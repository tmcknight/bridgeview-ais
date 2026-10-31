import Foundation

/// Why a photo is reported (REPORT_REASONS in server/photo-reports.js)
enum PhotoReportReason: String, Codable, CaseIterable, Sendable {
    case wrongShip = "wrong-ship"
    case offensive
    case privacy
    case copyright
    case other

    var label: String {
        switch self {
        case .wrongShip: "It's not this ship"
        case .offensive: "It's offensive or inappropriate"
        case .privacy: "It shows someone or something private"
        case .copyright: "It's my photo, used without permission"
        case .other: "Something else"
        }
    }
}

/// POST /api/ships/:mmsi/photos/report
struct PhotoReport: Codable, Sendable {
    var url: URL
    var reason: PhotoReportReason
    var details: String?
}
