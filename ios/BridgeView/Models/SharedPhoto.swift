import UIKit

/// Getting a photo ready to share: no bigger than the server shows, as a JPEG
enum SharedPhoto {
    /// Longest side, in pixels
    static let maxSide: CGFloat = 2048
    /// The server turns down photos smaller than this on their longest side
    /// (SHARED_PHOTO_SIZE in server/admin-api.js)
    static let minSide: CGFloat = 640

    /// Whether the photo is big enough to share
    static func isBigEnough(_ image: UIImage) -> Bool {
        max(image.size.width, image.size.height) * image.scale >= minSide
    }

    /// The photo redrawn upright at most `maxSide` across, as a JPEG. Redrawing
    /// leaves out the original's metadata (where it was taken, the camera);
    /// the server strips any that's left too.
    static func jpeg(from image: UIImage, quality: CGFloat = 0.85) -> Data? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return nil }
        let scale = min(1, maxSide / max(size.width * image.scale, size.height * image.scale)) * image.scale
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        // Plain SDR: an HDR photo would also carry a gain map, which the server cuts off
        format.preferredRange = .standard
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: quality)
    }
}
