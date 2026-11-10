import SwiftUI

/// The Recent tab: ships that went under the bridge in the last day, with the
/// favourites above them, and every ship the server has heard of when something's
/// typed in the search field
struct RecentView: View {
    @Environment(Favourites.self) private var favourites
    @Environment(BridgeStore.self) private var store

    @State private var query = ""
    @State private var results: ShipList?
    @State private var searchError: String?
    /// The favourites as the server last described them
    @State private var favouriteShips: [Int: Ship] = [:]
    @State private var favouritesError: String?

    private let api = APIClient()

    /// Waits this long after the last keystroke before searching (reads are rate-limited)
    static let typingPause: Duration = .milliseconds(300)
    /// How often the favourites are fetched again while they're on screen
    static let refreshInterval: Duration = .seconds(30)

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 10) {
                    if trimmed.isEmpty {
                        favouritesList
                        recentList
                    } else {
                        searchResults
                    }
                }
                .padding(.horizontal)
                .padding(.bottom)
                .readableWidth()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { RiverBackground() }
            .navigationTitle("Recent")
            .toolbarTitleDisplayMode(.inlineLarge)
            .searchable(text: $query, prompt: "Name, MMSI or IMO number")
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .navigationDestination(for: Int.self) { mmsi in
                ShipDetailView(mmsi: mmsi)
            }
            .task(id: trimmed) { await search() }
            .task(id: favourites.mmsis) {
                while !Task.isCancelled {
                    await loadFavourites()
                    try? await Task.sleep(for: Self.refreshInterval)
                }
            }
            .refreshable {
                if trimmed.isEmpty {
                    async let recent: Void = store.refresh()
                    async let starred: Void = loadFavourites()
                    _ = await (recent, starred)
                } else {
                    await search(waiting: false)
                }
            }
        }
    }

    // MARK: Recently passed

    @ViewBuilder private var recentList: some View {
        if !favourites.ships.isEmpty {
            SectionLabel("Passed in the last day")
                .padding(.top, 8)
        }
        if let ships = store.snapshot?.recent {
            if ships.isEmpty {
                ContentUnavailableView(
                    "No ships in the last day",
                    systemImage: "clock",
                    description: Text("Ships stay here for a day after they go under the \(Bridge.name).")
                )
                .padding(.top, favourites.ships.isEmpty ? 72 : 16)
            } else {
                ForEach(ships, id: \.recentRowID) { ship in
                    NavigationLink(value: ship.mmsi) {
                        ShipRow(ship: ship, mode: .recent)
                            .card(padding: 12)
                    }
                    .buttonStyle(.plain)
                    .shipMenu(ship, liveActivity: false)
                }
            }
            if let error = store.error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
            // At the end of the list, out of the way but still beside the data
            if let attribution = store.snapshot?.attribution, !attribution.isEmpty {
                DataCredits(attribution: attribution)
                    .padding(.top, 8)
            }
        } else if let error = store.error {
            ContentUnavailableView {
                Label("Can't reach BridgeView", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await store.refresh() } }
                    .prominentGlassButton()
            }
            .padding(.top, favourites.ships.isEmpty ? 72 : 16)
        } else {
            ProgressView()
                .padding(.top, 48)
        }
    }

    // MARK: Favourites

    /// Ships heard now first (soonest at the bridge first), then by name
    private var sortedFavourites: [Ship] {
        favourites.ships
            .map { favouriteShips[$0.mmsi] ?? Ship(mmsi: $0.mmsi, name: $0.name) }
            .sorted { a, b in
                if (a.heard == true) != (b.heard == true) { return a.heard == true }
                let etaA = a.approach?.etaMinutes ?? .infinity
                let etaB = b.approach?.etaMinutes ?? .infinity
                if etaA != etaB { return etaA < etaB }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
    }

    /// Nothing at all until a ship's starred, so the recent list stays at the top
    @ViewBuilder private var favouritesList: some View {
        if !favourites.ships.isEmpty {
            SectionLabel(String(localized: "Favourites"), systemImage: "star.fill")
                .padding(.top, 8)
            // Own IDs: a favourite that also passed in the last day is in both lists, and
            // the same ID twice in one LazyVStack leaves a gap until it's scrolled
            ForEach(sortedFavourites, id: \.favouriteRowID) { ship in
                SummaryCard(ship: ship)
            }
            if let favouritesError {
                Label(favouritesError, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
        }
    }

    private func loadFavourites() async {
        do {
            let list = try await api.ships(mmsis: favourites.mmsis)
            favouriteShips = Dictionary(list.ships.map { ($0.mmsi, $0) }, uniquingKeysWith: { a, _ in a })
            favouritesError = nil
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            favouritesError = APIError.message(for: error)
        }
    }

    // MARK: Search

    @ViewBuilder private var searchResults: some View {
        if trimmed.count < 2 {
            hint("Keep typing…")
        } else if let results {
            if results.ships.isEmpty {
                ContentUnavailableView.search(text: trimmed)
                    .padding(.top, 48)
            } else {
                ForEach(results.ships) { ship in
                    SummaryCard(ship: ship)
                }
                if results.more == true {
                    hint("More ships match. Type more of the name to narrow it down.")
                }
            }
        } else if let searchError {
            ContentUnavailableView {
                Label("Can't search right now", systemImage: "wifi.exclamationmark")
            } description: {
                Text(searchError)
            } actions: {
                Button("Try again") { Task { await search(waiting: false) } }
                    .prominentGlassButton()
            }
            .padding(.top, 48)
        } else {
            ProgressView()
                .padding(.top, 48)
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.top, 8)
    }

    private func search(waiting: Bool = true) async {
        let query = trimmed
        guard query.count >= 2 else {
            results = nil
            searchError = nil
            return
        }
        if waiting {
            try? await Task.sleep(for: Self.typingPause)
            guard !Task.isCancelled else { return }
            // Earlier results stay up while the next ones load, rather than flashing a spinner
        }
        do {
            let found = try await api.searchShips(query)
            guard !Task.isCancelled else { return }
            results = found
            searchError = nil
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            results = nil
            searchError = APIError.message(for: error)
        }
    }
}

/// A ship from search or Favourites: a link to its page. Starred from its page or by
/// pressing and holding
private struct SummaryCard: View {
    var ship: Ship

    var body: some View {
        NavigationLink(value: ship.mmsi) {
            ShipSummaryRow(ship: ship)
        }
        .buttonStyle(.plain)
        .card(padding: 12)
        .contextMenu {
            FavouriteToggle(mmsi: ship.mmsi, name: ship.name)
        }
    }
}

/// A ship summary (GET /api/ships): photo, name, what it is, and where it's at
struct ShipSummaryRow: View {
    var ship: Ship

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var thumbnailSize: CGFloat = 44

    var body: some View {
        TimelineView(.everyMinute) { _ in
            HStack(spacing: 12) {
                if !dynamicTypeSize.isAccessibilitySize { thumbnail }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(ship.name)
                            .font(Theme.hull(.subheadline))
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                            .minimumScaleFactor(0.75)
                        if let flag = ship.flagEmoji { Text(flag).font(.subheadline) }
                    }
                    if !ship.searchDetails.isEmpty {
                        Text(ship.searchDetails)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    }
                    Text(ship.status())
                        .font(.footnote.weight(ship.approach != nil ? .semibold : .regular))
                        .foregroundStyle(ship.approach != nil ? AnyShapeStyle(Theme.signal) : AnyShapeStyle(.secondary))
                }
                Spacer(minLength: 0)
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ship.name)
        .accessibilityValue(accessibilityDetails)
        .accessibilityInputLabels([ship.name])
    }

    private var accessibilityDetails: String {
        var sentences: [String] = []
        if let country = ship.flagCountry { sentences.append("Flag: \(country)") }
        if !ship.searchDetails.isEmpty { sentences.append(Format.spoken(ship.searchDetails)) }
        sentences.append(Format.spoken(ship.status(spoken: true)))
        return sentences.joined(separator: ". ")
    }

    @ViewBuilder private var thumbnail: some View {
        let shape = RoundedRectangle(cornerRadius: 11)
        Group {
            if let url = ship.photoUrl {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.secondary.opacity(0.15)
                }
            } else {
                DirectionBadge(direction: ship.approach?.direction, followsCompass: false)
            }
        }
        .frame(width: thumbnailSize, height: thumbnailSize)
        .clipShape(shape)
        .accessibilityHidden(true)
    }
}

/// "Favourite" ("Favorite" in the US) as a ticked menu item, for pressing and holding a ship
struct FavouriteToggle: View {
    @Environment(Favourites.self) private var favourites

    var mmsi: Int
    var name: String

    var body: some View {
        Toggle(isOn: Binding {
            favourites.contains(mmsi)
        } set: { _ in
            favourites.toggle(mmsi: mmsi, name: name)
        }) {
            Label("Favourite", systemImage: "star")
        }
    }
}

private extension Ship {
    var favouriteRowID: String { "favourite-\(mmsi)" }
    var recentRowID: String { "recent-\(mmsi)" }
}
