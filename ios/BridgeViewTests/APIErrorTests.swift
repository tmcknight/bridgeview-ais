import Foundation
import Testing
@testable import BridgeView

struct APIErrorTests {
    @Test func explainsUnreachableServerInPlainWords() {
        #expect(APIError.message(for: URLError(.notConnectedToInternet)).hasPrefix("You're offline"))
        #expect(APIError.message(for: URLError(.cannotConnectToHost)).hasPrefix("BridgeView's server isn't answering"))
        #expect(APIError.message(for: URLError(.timedOut)).hasPrefix("BridgeView's server is taking too long"))
        #expect(APIError.message(for: APIError.status(502)).hasPrefix("BridgeView's server is having trouble (502)"))
    }
}
