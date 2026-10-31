import Foundation
import Security

/// A random ID for this install, sent with shared photos so a sender can be
/// banned (there are no accounts). Kept in the keychain, so it outlasts
/// reinstalling the app; it says nothing about the phone or its owner.
enum DeviceID {
    private static let service = "BridgeView.DeviceID"

    static let current: String = load() ?? create()

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
    }

    private static func load() -> String? {
        var item: CFTypeRef?
        var search = query
        search[kSecReturnData as String] = true
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func create() -> String {
        let id = UUID().uuidString.lowercased()
        var item = query
        item[kSecValueData as String] = Data(id.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
        return id
    }
}
