import MapKit
import SwiftUI

/// Everything known about one ship, with links to find out more
struct ShipDetailView: View {
    @Environment(BridgeStore.self) private var store

    var mmsi: Int
    @State private var ship: Ship?
    @State private var error: String?

    private let api = APIClient()

    var body: some View {
        Group {
            if let ship = ship ?? cachedShip {
                ShipDetailContent(
                    ship: ship,
                    attribution: store.snapshot?.attribution ?? []
                )
            } else if let error {
                ContentUnavailableView("Ship unavailable", systemImage: "ferry", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { RiverBackground() }
        .navigationTitle(ship?.name ?? cachedShip?.name ?? "Ship")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: mmsi) { await load() }
        .refreshable { await load() }
    }

    /// The ship from the list, shown while the full details load
    private var cachedShip: Ship? {
        guard let snapshot = store.snapshot else { return nil }
        return (snapshot.upcoming + snapshot.recent).first { $0.mmsi == mmsi }
    }

    private func load() async {
        do {
            ship = try await api.ship(mmsi: mmsi)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct ShipDetailContent: View {
    var ship: Ship
    var attribution: [Attribution]

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                header
                if let approach = ship.approach {
                    approachCard(approach)
                }
                if let position = ship.position {
                    VStack(alignment: .leading, spacing: 6) {
                        ShipMap(position: position, name: ship.name)
                            .frame(height: 230)
                            .clipShape(.rect(cornerRadius: Theme.cornerRadius))
                            .overlay {
                                RoundedRectangle(cornerRadius: Theme.cornerRadius)
                                    .strokeBorder(Theme.hairline)
                            }
                        Text("Last position \(position.time, format: .relative(presentation: .named))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)
                    }
                }
                facts
                passages
                links
                if !attribution.isEmpty {
                    DataCredits(attribution: attribution)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .background { RiverBackground() }
    }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                photo
                LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ship.name)
                        .font(Theme.hull(.title))
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                    if let flag = ship.flagEmoji { Text(flag).font(.title2) }
                }
                .foregroundStyle(.white)
                .shadow(radius: 4)
                .padding(16)
            }
            .frame(height: 220)
            .clipped()
            if ship.info?.description != nil || ship.cargo != nil || !ship.summary.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    if !ship.summary.isEmpty {
                        Text(ship.summary.uppercased())
                            .font(.caption.weight(.bold))
                            .tracking(1.2)
                            .foregroundStyle(Theme.signal)
                    }
                    if let description = ship.info?.description {
                        Text(description).foregroundStyle(.secondary)
                    }
                    if let cargo = ship.cargo {
                        Label(cargo, systemImage: "shippingbox.fill").font(.subheadline.weight(.medium))
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Theme.surface)
        .clipShape(.rect(cornerRadius: Theme.cornerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .strokeBorder(Theme.hairline)
        }
        .padding(.top, 8)
    }

    @ViewBuilder private var photo: some View {
        if let imageURL = ship.info?.imageUrl {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .failure:
                    PhotoPlaceholder()
                default:
                    PhotoPlaceholder().overlay(ProgressView().tint(.white))
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityLabel("Photo of \(ship.name)")
        } else {
            PhotoPlaceholder()
        }
    }

    private func approachCard(_ approach: Approach) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                SectionLabel("Heading for the bridge")
                DirectionBadge(direction: approach.direction, course: ship.position?.course)
                    .scaleEffect(0.8)
            }
            Group {
                if approach.eta > .now {
                    Text(timerInterval: Date.now...approach.eta, countsDown: true)
                } else {
                    Text("Now")
                }
            }
            .font(Theme.figure(.largeTitle, weight: .heavy))
            .foregroundStyle(Theme.signal)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 14) {
                GridRow {
                    Stat(label: "ETA", value: Text(approach.eta, style: .time))
                    Stat(label: "Distance", value: Text(Format.distance(approach.distanceNM)))
                }
                GridRow {
                    Stat(label: "Direction", value: Text(approach.direction.label))
                    if let sog = ship.position?.sog {
                        Stat(label: "Speed", value: Text(Format.speed(sog)))
                    }
                }
            }
        }
        .card()
    }

    @ViewBuilder private var facts: some View {
        let rows: [(String, String?)] = [
            ("Type", ship.shipTypeName),
            ("Size", size),
            ("Draught", ship.draught.map { String(format: "%.1f m", $0) }),
            ("Destination", ship.destination.map(Format.place)),
            ("Built", ship.info?.yearBuilt.map(String.init)),
            ("Builder", ship.info?.builder),
            ("Operator", ship.info?.operator),
            ("Gross tonnage", ship.info?.grossTonnage.map { $0.formatted(.number.precision(.fractionLength(0))) }),
            ("IMO", ship.imo.map(String.init)),
            ("MMSI", String(ship.mmsi)),
            ("Call sign", ship.callSign),
        ]
        let shown = rows.compactMap { title, value in
            value.flatMap { $0.isEmpty ? nil : (title, $0) }
        }
        VStack(spacing: 8) {
            SectionLabel("Details")
            VStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, row in
                    if index > 0 { Divider().overlay(Theme.hairline) }
                    LabeledContent(row.0) {
                        Text(row.1)
                            .multilineTextAlignment(.trailing)
                    }
                    .padding(.vertical, 10)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
            .card(padding: 0)
        }
    }

    @ViewBuilder private var passages: some View {
        let list = ship.passages ?? ship.passage.map { [$0] } ?? []
        if !list.isEmpty {
            VStack(spacing: 8) {
                SectionLabel("Under the bridge")
                VStack(spacing: 0) {
                    ForEach(Array(list.prefix(10).enumerated()), id: \.element.time) { index, passage in
                        if index > 0 { Divider().overlay(Theme.hairline) }
                        HStack(spacing: 10) {
                            Image(systemName: passage.direction.symbol)
                                .font(.subheadline.weight(.heavy))
                                .foregroundStyle(Theme.color(for: passage.direction))
                                .frame(width: 20)
                            Text(passage.direction.label)
                            Spacer()
                            Text(passage.time.formatted(date: .abbreviated, time: .shortened))
                                .font(Theme.figure(.subheadline, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 10)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
                .card(padding: 0)
            }
        }
    }

    @ViewBuilder private var links: some View {
        VStack(spacing: 8) {
            SectionLabel("More about this ship")
            VStack(spacing: 0) {
                ForEach(Array(ShipLinks.for(ship).enumerated()), id: \.element.id) { index, link in
                    if index > 0 { Divider().overlay(Theme.hairline) }
                    Link(destination: link.url) {
                        HStack(spacing: 12) {
                            Image(systemName: link.symbol)
                                .foregroundStyle(Theme.signal)
                                .frame(width: 24)
                            Text(link.title)
                                .foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 12)
                        .contentShape(.rect)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
            .card(padding: 0)
        }
    }

    private var size: String? {
        switch (ship.length, ship.width) {
        case let (length?, width?): "\(length) × \(width) m"
        case let (length?, nil): "\(length) m long"
        default: nil
        }
    }
}

/// River blue with a ship, where there's no photo
private struct PhotoPlaceholder: View {
    var body: some View {
        LinearGradient(colors: [Theme.shallows, Theme.river], startPoint: .topTrailing, endPoint: .bottomLeading)
            .overlay {
                Image(systemName: "ferry.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.white.opacity(0.18))
            }
    }
}

private struct ShipMap: View {
    var position: Position
    var name: String

    var body: some View {
        let ship = CLLocationCoordinate2D(latitude: position.latitude, longitude: position.longitude)
        Map(initialPosition: .rect(Self.rect(ship, Bridge.center)), interactionModes: [.pan, .zoom]) {
            Marker(Bridge.name, systemImage: "road.lanes", coordinate: Bridge.center)
                .tint(.gray)
            Annotation(name, coordinate: ship) {
                Image(systemName: "location.north.fill")
                    .font(.title3)
                    .foregroundStyle(Theme.signal)
                    .rotationEffect(.degrees(position.course ?? 0))
                    .shadow(radius: 2)
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
    }

    /// A rect around both points with some margin
    private static func rect(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> MKMapRect {
        let pa = MKMapPoint(a), pb = MKMapPoint(b)
        let rect = MKMapRect(
            x: min(pa.x, pb.x), y: min(pa.y, pb.y),
            width: abs(pa.x - pb.x), height: abs(pa.y - pb.y)
        )
        let margin = max(max(rect.width, rect.height) * 0.3, 3000)
        return rect.insetBy(dx: -margin, dy: -margin)
    }
}
