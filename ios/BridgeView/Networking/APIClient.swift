import Foundation

enum APIError: LocalizedError {
    case status(Int)
    case notFound

    var errorDescription: String? {
        switch self {
        case .status(let code): "The server answered with an error (\(code))."
        case .notFound: "This ship isn't known to the server."
        }
    }
}

/// The BridgeView server's HTTP API (ios/API.md)
struct APIClient: Sendable {
    var baseURL: URL = AppConfig.apiURL
    var session: URLSession = .shared

    func bridge() async throws -> BridgeSnapshot {
        try await get("api/bridge")
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

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path))
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
