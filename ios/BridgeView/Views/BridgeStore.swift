import Foundation
import Observation

/// Ships heading for the bridge and ships that went under it lately, polled
/// from the server while the app is on screen
@MainActor
@Observable
final class BridgeStore {
    static let pollInterval: Duration = .seconds(30)

    private(set) var snapshot: BridgeSnapshot?
    private(set) var error: String?
    private(set) var isLoading = false

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    /// Poll until the calling task is cancelled (use from `.task`)
    func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: Self.pollInterval)
        }
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            snapshot = try await api.bridge()
            error = nil
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }
}
