import Foundation

/// Build settings surfaced through Info.plist (see Config/*.xcconfig)
enum AppConfig {
    /// Root of the BridgeView server, e.g. https://bridgeview.example.com
    static let apiURL: URL = {
        let value = Bundle.main.object(forInfoDictionaryKey: "BridgeViewAPIURL") as? String
        return value.flatMap(URL.init(string:)) ?? URL(string: "https://bridgeview.example.com")!
    }()

    /// APNs environment the device token belongs to: "sandbox" or "production"
    static let pushEnvironment: String = {
        Bundle.main.object(forInfoDictionaryKey: "BridgeViewPushEnvironment") as? String ?? "production"
    }()
}
