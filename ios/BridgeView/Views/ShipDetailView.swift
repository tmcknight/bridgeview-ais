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
                    attribution: store.snapshot?.attribution ?? [],
                    photoSharing: store.snapshot?.photoSharing ?? false,
                    photoReporting: store.snapshot?.photoReporting ?? false
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
            self.error = APIError.message(for: error)
        }
    }
}

private struct ShipDetailContent: View {
    var ship: Ship
    var attribution: [Attribution]
    var photoSharing: Bool
    var photoReporting: Bool
    @State private var photoIndex = 0
    @State private var sharingPhoto = false
    @State private var reportingPhoto: VesselPhoto?
    @State private var reportResult: String?
    @State private var mapExpanded = false
    @State private var photosExpanded = false
    @Environment(\.openURL) private var openURL

    private let api = APIClient()

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                header
                if let approach = ship.approach {
                    approachCard(approach)
                }
                if let position = ship.position {
                    VStack(alignment: .leading, spacing: 6) {
                        // A still preview; tapping opens it full screen to pan and zoom
                        Button {
                            mapExpanded = true
                        } label: {
                            ShipMap(ship: ship, position: position, interactive: false)
                                .frame(height: 230)
                                .clipShape(.rect(cornerRadius: Theme.cornerRadius))
                                .overlay {
                                    RoundedRectangle(cornerRadius: Theme.cornerRadius)
                                        .strokeBorder(Theme.hairline)
                                }
                                .overlay(alignment: .topTrailing) {
                                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(.white)
                                        .frame(width: 28, height: 28)
                                        .glassPill()
                                        .environment(\.colorScheme, .dark)
                                        .padding(10)
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Map of \(ship.name)")
                        .accessibilityHint("Opens the map full screen")
                        .fullScreenCover(isPresented: $mapExpanded) {
                            NavigationStack {
                                ShipMap(ship: ship, position: position, interactive: true)
                                    .ignoresSafeArea(edges: .bottom)
                                    .navigationTitle(ship.name)
                                    .toolbarTitleDisplayMode(.inline)
                                    .toolbar {
                                        ToolbarItem(placement: .confirmationAction) {
                                            Button("Done") { mapExpanded = false }
                                        }
                                    }
                            }
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
            .readableWidth()
        }
        .background { RiverBackground() }
        .sheet(isPresented: $sharingPhoto) {
            SharePhotoView(mmsi: ship.mmsi, shipName: ship.name)
        }
        .confirmationDialog(
            "Why are you reporting this photo?",
            isPresented: Binding { reportingPhoto != nil } set: { if !$0 { reportingPhoto = nil } },
            titleVisibility: .visible,
            presenting: reportingPhoto
        ) { photo in
            ForEach(PhotoReportReason.allCases, id: \.self) { reason in
                Button(reason.label) { Task { await report(photo, reason) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("BridgeView checks every report and takes down photos that shouldn't be here.")
        }
        .alert(
            reportResult ?? "",
            isPresented: Binding { reportResult != nil } set: { if !$0 { reportResult = nil } }
        ) {
            Button("OK") {}
        }
    }

    /// The photo being shown, if there is one
    private var currentPhoto: VesselPhoto? {
        let photos = ship.info?.allPhotos ?? []
        return photos.isEmpty ? nil : photos[min(photoIndex, photos.count - 1)]
    }

    /// Asks why the photo is being reported; without reporting on the server,
    /// opens the support page, which says how to report one by email
    private func startReport(_ photo: VesselPhoto) {
        if photoReporting {
            reportingPhoto = photo
        } else {
            openURL(AppConfig.apiURL.appending(path: "support.html"))
        }
    }

    private func report(_ photo: VesselPhoto, _ reason: PhotoReportReason) async {
        do {
            try await api.reportPhoto(mmsi: ship.mmsi, PhotoReport(url: photo.url, reason: reason))
            reportResult = "Thanks. We'll take a look at this photo."
        } catch {
            reportResult = APIError.message(for: error)
        }
    }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Size the box first: a filled photo is larger than it, and would push
            // the name below the clipped edge if it set the size
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: 220)
                .overlay { photo }
                .clipped()
                // The shade and name let touches through, so the photos can be swiped.
                // Shaded at the top too, so the buttons and credit read on a light photo
                .overlay {
                    LinearGradient(
                        stops: [
                            .init(color: .black.opacity(0.45), location: 0),
                            .init(color: .clear, location: 0.3),
                            .init(color: .clear, location: 0.5),
                            .init(color: .black.opacity(0.65), location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .allowsHitTesting(false)
                }
                .overlay(alignment: .bottomLeading) {
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
                    .allowsHitTesting(false)
                }
                // The photo's credit, small along the bottom edge below the name, so it
                // doesn't cover the photo or crowd the buttons at the top
                .overlay(alignment: .bottomTrailing) {
                    if let credit = currentPhoto?.credit {
                        Text(credit)
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.white.opacity(0.8))
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(maxWidth: 240, alignment: .trailing)
                            .padding(.horizontal, 8)
                            .padding(.bottom, 3)
                            .allowsHitTesting(false)
                            .accessibilityLabel("Photo: \(credit)")
                    }
                }
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 6) {
                        if photoSharing {
                            Button {
                                sharingPhoto = true
                            } label: {
                                Label("Add photo", systemImage: "camera.fill")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .glassPill()
                            }
                            .accessibilityLabel("Share a photo of \(ship.name)")
                        }
                        if let photo = currentPhoto {
                            Menu {
                                Button("Report this photo", systemImage: "flag") { startReport(photo) }
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 28, height: 28)
                                    .glassPill()
                            }
                            .accessibilityLabel("Photo options")
                        }
                    }
                    // Dark glass, whatever the app's appearance, so white reads on it
                    .environment(\.colorScheme, .dark)
                    .padding(10)
                }
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
        let photos = ship.info?.allPhotos ?? []
        if photos.isEmpty {
            PhotoPlaceholder()
        } else {
            // Swipe through the ship's photos (round from the last to the first);
            // tap to see them full screen
            PhotoPager(photos: photos, index: $photoIndex) { photo in
                AsyncImage(url: photo.url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        PhotoPlaceholder()
                    default:
                        PhotoPlaceholder().overlay(ProgressView().tint(.white))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .contentShape(.rect)
                .onTapGesture { photosExpanded = true }
            }
            .fullScreenCover(isPresented: $photosExpanded) {
                PhotoViewer(photos: photos, title: ship.name, index: $photoIndex)
            }
            .overlay(alignment: .topTrailing) {
                if photos.count > 1 {
                    Text("\(photoIndex + 1) / \(photos.count)")
                        .monospacedDigit()
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.black.opacity(0.6), in: .rect(cornerRadius: 6))
                        .padding(10)
                        .allowsHitTesting(false)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Photos of \(ship.name), \(photoIndex + 1) of \(photos.count)")
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens the photos full screen")
            .accessibilityAction { photosExpanded = true }
            .accessibilityAdjustableAction { direction in
                guard photos.count > 1 else { return }
                switch direction {
                case .increment: photoIndex = (photoIndex + 1) % photos.count
                case .decrement: photoIndex = (photoIndex - 1 + photos.count) % photos.count
                @unknown default: break
                }
            }
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
            LiveActivityToggle(mmsi: ship.mmsi)
        }
        .card()
    }

    /// USCG service type, e.g. "Freight Ship, Self-Discharging"
    private var service: String? {
        guard let uscg = ship.info?.uscg, let type = uscg.serviceType else { return nil }
        return [type, uscg.serviceSubType].compactMap { $0 }.joined(separator: ", ")
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
            ("Service", service),
            ("Gross tonnage", ship.info?.grossTonnage.map { $0.formatted(.number.precision(.fractionLength(0))) }),
            ("Deadweight", ship.info?.uscg?.deadweight.map { "\($0.formatted(.number.precision(.fractionLength(0)))) t" }),
            ("Engine power", ship.info?.registry?.enginePowerKw.map { "\($0.formatted(.number.precision(.fractionLength(0)))) kW" }),
            ("Port of registry", ship.info?.registry?.portOfRegistry?.capitalized),
            ("Official number", ship.info?.registry?.officialNumber ?? ship.info?.uscg?.officialNumber),
            ("Hull number", ship.info?.registry?.hullNumber),
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

/// The ship and the bridge on a map, the ship drawn as on the live map
private struct ShipMap: View {
    var ship: Ship
    var position: Position
    /// Pan and zoom, with every other ship heard lately (full screen), or a still preview
    var interactive: Bool

    @State private var metresPerPoint: Double = 30
    @State private var mapHeight: CGFloat = 0
    /// Every ship from GET /api/map, while full screen
    @State private var snapshot: MapSnapshot?
    @State private var motion = ShipMotion()

    private let api = APIClient()

    var body: some View {
        let coordinate = CLLocationCoordinate2D(latitude: position.latitude, longitude: position.longitude)
        // Redrawn every frame while ships move (full screen), so they glide between reports
        TimelineView(.animation(
            minimumInterval: ShipMotion.frameInterval,
            paused: !interactive || !motion.isMoving(at: .now)
        )) { context in
            Map(
                initialPosition: .rect(Self.rect(coordinate, Bridge.center)),
                interactionModes: interactive ? [.pan, .zoom] : []
            ) {
                Marker(Bridge.name, systemImage: "road.lanes", coordinate: Bridge.center)
                    .tint(.gray)
                ForEach(others) { other in
                    if let drawn = motion.drawn(other, at: context.date) {
                        Annotation(other.name, coordinate: drawn.coordinate, anchor: .center) {
                            MapShipMarker(ship: other, course: drawn.course, isSelected: false, metresPerPoint: metresPerPoint)
                        }
                        .annotationTitles(.hidden)
                    }
                }
                // This ship last, so it's drawn over the others; picked out when they're shown
                let current = motion.drawn(followed, at: context.date)
                    ?? .init(coordinate: latestPosition.coordinate(at: context.date), course: latestPosition.course)
                Annotation(ship.name, coordinate: current.coordinate, anchor: .center) {
                    MapShipMarker(ship: ship, course: current.course, isSelected: interactive, metresPerPoint: metresPerPoint)
                }
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .mapControls {
                if interactive {
                    MapCompass()
                    MapScaleView()
                }
            }
            .onMapCameraChange(frequency: .continuous) { context in
                guard mapHeight > 0 else { return }
                metresPerPoint = context.region.span.latitudeDelta * LiveMapView.metresPerDegreeLatitude / mapHeight
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { mapHeight = $0 }
        .task(id: interactive) {
            guard interactive else { return }
            // Polls only while full screen; a failed poll just keeps the last ships
            while !Task.isCancelled {
                if let latest = try? await api.map() {
                    snapshot = latest
                    motion.update(latest.ships.filter { $0.mmsi != ship.mmsi } + [followed])
                }
                try? await Task.sleep(for: LiveMapView.pollInterval)
            }
        }
    }

    private var others: [Ship] {
        snapshot?.ships.filter { $0.mmsi != ship.mmsi && $0.position != nil } ?? []
    }

    /// This ship with its latest position
    private var followed: Ship {
        var followed = ship
        followed.position = latestPosition
        return followed
    }

    /// This ship's position from the map's latest poll when newer than the page's
    private var latestPosition: Position {
        guard let polled = snapshot?.ships.first(where: { $0.mmsi == ship.mmsi })?.position,
              polled.time > position.time else { return position }
        return polled
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
