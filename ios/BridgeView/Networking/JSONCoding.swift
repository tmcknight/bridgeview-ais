import Foundation

extension JSONDecoder {
    /// Decodes the REST API's ISO 8601 dates, with or without fractional seconds
    static let api: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = try? Date(text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) {
                return date
            }
            if let date = try? Date(text, strategy: .iso8601) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 date: \(text)")
        }
        return decoder
    }()
}

extension JSONEncoder {
    static let api: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
}
