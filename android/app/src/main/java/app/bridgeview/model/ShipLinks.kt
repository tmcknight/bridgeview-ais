package app.bridgeview.model

/** Outside pages with more about a ship */
data class ExternalLink(val title: String, val kind: Kind, val url: String) {
    enum class Kind { Book, Data, Photo, Registry }
}

object ShipLinks {
    fun forShip(ship: Ship): List<ExternalLink> {
        val links = mutableListOf<ExternalLink>()
        fun add(title: String, kind: ExternalLink.Kind, url: String?) {
            if (url != null) links += ExternalLink(title, kind, url)
        }
        add("Wikipedia", ExternalLink.Kind.Book, ship.info?.wikipediaUrl)
        add("Wikidata", ExternalLink.Kind.Data, ship.info?.wikidataUrl)
        add("Photo on Wikimedia Commons", ExternalLink.Kind.Photo, ship.info?.imagePageUrl)
        if (ship.info?.registry != null) {
            add(
                "Transport Canada vessel register",
                ExternalLink.Kind.Registry,
                "https://open.canada.ca/data/en/dataset/bf00b7f4-e370-46b7-94e4-0bdedc98531b",
            )
        }
        return links
    }

    /** The Port Huron ship cam's live video on YouTube */
    fun shipCam(videoId: String?): String? = videoId?.let { "https://www.youtube.com/watch?v=$it" }
}
