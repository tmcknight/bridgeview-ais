import Foundation

/// Outside pages with more about a ship
struct ExternalLink: Identifiable, Hashable {
    var title: String
    var symbol: String
    var url: URL
    var id: URL { url }
}

enum ShipLinks {
    static func `for`(_ ship: Ship) -> [ExternalLink] {
        var links: [ExternalLink] = []
        func add(_ title: String, _ symbol: String, _ url: URL?) {
            if let url { links.append(ExternalLink(title: title, symbol: symbol, url: url)) }
        }
        add("VesselFinder", "location.magnifyingglass", URL(string: "https://www.vesselfinder.com/vessels/details/\(ship.mmsi)"))
        add("MarineTraffic", "map", URL(string: "https://www.marinetraffic.com/en/ais/details/ships/mmsi:\(ship.mmsi)"))
        add("Wikipedia", "book", ship.info?.wikipediaUrl)
        add("Wikidata", "list.bullet.rectangle", ship.info?.wikidataUrl)
        add("Photo on Wikimedia Commons", "photo", ship.info?.imagePageUrl)
        return links
    }

    /// The Port Huron ship cam's live video on YouTube
    static func shipCam(videoId: String?) -> URL? {
        videoId.flatMap { URL(string: "https://www.youtube.com/watch?v=\($0)") }
    }
}
