import Foundation

enum APIError: LocalizedError {
    case status(Int)
    case notFound

    var errorDescription: String? {
        switch self {
        case .status(429): "Too many requests to BridgeView. Try again in a minute."
        case .status(let code) where code >= 500: "BridgeView's server is having trouble (\(code)). Try again in a few minutes."
        case .status(let code): "BridgeView's server answered with an error (\(code))."
        case .notFound: "This ship isn't known to the server."
        }
    }

    /// What to tell the user about a failed request, in plain words
    static func message(for error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                return "You're offline. Ships will show again once you're connected."
            case .timedOut:
                return "BridgeView's server is taking too long to answer. Check your connection, or try again in a few minutes."
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .badServerResponse:
                return "BridgeView's server isn't answering right now. It may be restarting; try again in a few minutes."
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot:
                return "Couldn't make a secure connection to BridgeView. If you're on public Wi-Fi, you may need to sign in to it first."
            default:
                break
            }
        }
        if error is DecodingError {
            return "BridgeView's server sent something this version of the app can't read. Check for an app update."
        }
        return error.localizedDescription
    }
}

/// The BridgeView server's HTTP API (ios/API.md)
struct APIClient: Sendable {
    var baseURL: URL = AppConfig.apiURL
    var session: URLSession = .shared

    func bridge() async throws -> BridgeSnapshot {
        try await get("api/bridge")
    }

    func map() async throws -> MapSnapshot {
        try await get("api/map")
    }

    func ship(mmsi: Int) async throws -> Ship {
        try await get("api/ships/\(mmsi)")
    }

    func register(deviceToken: String, _ registration: DeviceRegistration) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/devices/\(deviceToken)"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.api.encode(registration)
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    /// API v2: ship details may come from the vessel registers alone, without Wikidata
    private static let version = URLQueryItem(name: "v", value: "2")

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path).appending(queryItems: [Self.version]))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        try check(response)
        return try JSONDecoder.api.decode(T.self, from: data)
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if http.statusCode == 404 { throw APIError.notFound }
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
    }
}
