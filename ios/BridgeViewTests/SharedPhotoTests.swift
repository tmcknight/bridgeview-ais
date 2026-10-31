import Testing
import UIKit
@testable import BridgeView

struct SharedPhotoTests {
    private func image(width: CGFloat, height: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    @Test func shrinksBigPhotosToTheLongestSide() throws {
        let data = try #require(SharedPhoto.jpeg(from: image(width: 4000, height: 3000)))
        let result = try #require(UIImage(data: data))
        #expect(result.size.width * result.scale == 2048)
        #expect(result.size.height * result.scale == 1536)
        #expect(data.prefix(3) == Data([0xff, 0xd8, 0xff]))
    }

    @Test func knowsWhenAPhotoIsTooSmall() {
        #expect(SharedPhoto.isBigEnough(image(width: 640, height: 480)))
        #expect(!SharedPhoto.isBigEnough(image(width: 600, height: 400)))
    }

    @Test func leavesSmallPhotosTheirSize() throws {
        let data = try #require(SharedPhoto.jpeg(from: image(width: 800, height: 600)))
        let result = try #require(UIImage(data: data))
        #expect(result.size.width * result.scale == 800)
    }
}

struct PhotoReportTests {
    @Test func encodesReportBody() throws {
        let report = PhotoReport(url: URL(string: "https://photos.example/shared/a.jpg")!, reason: .wrongShip)
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api.encode(report)) as? [String: Any])
        #expect(object["url"] as? String == "https://photos.example/shared/a.jpg")
        #expect(object["reason"] as? String == "wrong-ship")
        #expect(object["details"] == nil)
    }
}
