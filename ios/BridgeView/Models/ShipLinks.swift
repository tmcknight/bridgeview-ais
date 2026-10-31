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
        // By IMO when known: the VesselFinder and MarineTraffic apps take these links
        // over, and open on the ship for an IMO but not an MMSI (the websites take either)
        let marineTrafficID = ship.imo.map { "imo:\($0)" } ?? "mmsi:\(ship.mmsi)"
        add("VesselFinder", "location.magnifyingglass", URL(string: "https://www.vesselfinder.com/vessels/details/\(ship.imo ?? ship.mmsi)"))
        add("MarineTraffic", "map", URL(string: "https://www.marinetraffic.com/en/ais/details/ships/\(marineTrafficID)"))
        add("Wikipedia", "book", ship.info?.wikipediaUrl)
        add("Wikidata", "list.bullet.rectangle", ship.info?.wikidataUrl)
        add("Photo on Wikimedia Commons", "photo", ship.info?.imagePageUrl)
        if ship.info?.uscg != nil {
            add("USCG vessel records", "building.columns", URL(string: "https://cgmix.uscg.mil/psix/"))
        }
        if ship.info?.registry != nil {
            add("Transport Canada vessel register", "building.columns", URL(string: "https://open.canada.ca/data/en/dataset/bf00b7f4-e370-46b7-94e4-0bdedc98531b"))
        }
        return links
    }

    /// The Port Huron ship cam's live video on YouTube
    static func shipCam(videoId: String?) -> URL? {
        videoId.flatMap { URL(string: "https://www.youtube.com/watch?v=\($0)") }
    }
}
