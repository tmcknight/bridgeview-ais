import MapKit
import SwiftUI

/// Every ship near the bridge on a map, moved along its course between updates
struct LiveMapView: View {
    static let pollInterval: Duration = .seconds(5)
    static let metresPerDegreeLatitude = 111_320.0

    @State private var snapshot: MapSnapshot?
    @State private var motion = ShipMotion()
    @State private var error: String?
    @State private var selected: Int?
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(
        center: Bridge.center, latitudinalMeters: 9000, longitudinalMeters: 9000
    ))
    /// Ground metres across one point on screen, so hulls are drawn to scale
    @State private var metresPerPoint: Double = 30
    @State private var mapHeight: CGFloat = 0

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            // Redrawn every frame while ships move, so they glide between reports
            TimelineView(.animation(minimumInterval: ShipMotion.frameInterval, paused: !motion.isMoving(at: .now))) { context in
                // No rotating: the ship markers point north-up
                Map(position: $camera, interactionModes: [.pan, .zoom]) {
                    Marker(Bridge.name, systemImage: "road.lanes", coordinate: Bridge.center)
                        .tint(.gray)
                    ForEach(ships) { ship in
                        if let drawn = motion.drawn(ship, at: context.date) {
                            Annotation(ship.name, coordinate: drawn.coordinate, anchor: .center) {
                                MapShipMarker(ship: ship, course: drawn.course, isSelected: ship.mmsi == selected, metresPerPoint: metresPerPoint)
                                    .onTapGesture { selected = ship.mmsi }
                            }
                            .annotationTitles(ship.mmsi == selected ? .visible : .hidden)
                        }
                    }
                }
                .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
                .mapControls {
                    MapCompass()
                    MapScaleView()
                }
                .onMapCameraChange(frequency: .continuous) { context in
                    guard mapHeight > 0 else { return }
                    metresPerPoint = context.region.span.latitudeDelta * Self.metresPerDegreeLatitude / mapHeight
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { mapHeight = $0 }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if let ship = selectedShip {
                        SelectedShipCard(ship: ship) { selected = nil }
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .glassPill()
                    }
                    if let attribution = snapshot?.attribution, !attribution.isEmpty {
                        DataCredits(attribution: attribution)
                            .fixedSize()
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .glassPill()
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 4)
            }
            .navigationTitle("Map")
            .toolbarTitleDisplayMode(.inline)
            .navigationDestination(for: Int.self) { mmsi in
                ShipDetailView(mmsi: mmsi)
            }
            // Polls only while the map is on screen
            .task { await poll() }
        }
    }

    private var ships: [Ship] {
        snapshot?.ships.filter { $0.position != nil } ?? []
    }

    private var selectedShip: Ship? {
        selected.flatMap { mmsi in ships.first { $0.mmsi == mmsi } }
    }

    private func poll() async {
        while !Task.isCancelled {
            do {
                let latest = try await api.map()
                motion.update(latest.ships)
                snapshot = latest
                error = nil
            } catch is CancellationError {
                return
            } catch let urlError as URLError where urlError.code == .cancelled {
                return
            } catch {
                self.error = APIError.message(for: error)
            }
            try? await Task.sleep(for: Self.pollInterval)
        }
    }
}

/// A ship on the map. Ships that send their size are drawn as a hull to scale
/// (square stern, pointed bow), turned to their heading and kept big enough to
/// see when zoomed out; others are an arrow along their course when under way,
/// a dot when not. Ships heading for the bridge take their direction's colour.
struct MapShipMarker: View {
    var ship: Ship
    /// Which way it's drawn pointing (eased between reports); its reported course when nil
    var course: Double?
    var isSelected: Bool
    var metresPerPoint: Double

    // The smallest a hull is drawn, in points
    private static let minLength: Double = 18
    private static let minBeam: Double = 6
    // Pleasure craft stay smaller than the ships they share the river with
    private static let minLengthClassB: Double = 10
    private static let minBeamClassB: Double = 4
    // Taps land anywhere in this, however small the ship
    private static let hitSize: Double = 32

    var body: some View {
        Group {
            if let hull {
                let side = max(hull.length, hull.beam, Self.hitSize)
                HullShape()
                    .fill(color)
                    .stroke(isSelected ? .white : .white.opacity(0.85), lineWidth: isSelected ? 2.5 : 1)
                    .frame(width: hull.beam, height: hull.length)
                    .rotationEffect(.degrees(hull.heading))
                    .shadow(color: .black.opacity(isSelected ? 0.6 : 0.35), radius: isSelected ? 4 : 1.5)
                    .frame(width: side, height: side)
            } else {
                arrow
            }
        }
        // A bigger target than the ship, so small ones are easy to tap
        .contentShape(.circle)
        .accessibilityLabel(ship.name)
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private var arrow: some View {
        let small = ship.classB == true
        Group {
            if let position = ship.position, position.isUnderWay, let course = course ?? position.course {
                Image(systemName: "location.north.fill")
                    .rotationEffect(.degrees(course))
            } else {
                Image(systemName: "circle.fill")
                    .font(small ? .system(size: 7) : .caption2)
            }
        }
        .font(small ? .footnote : .title3)
        .foregroundStyle(color)
        .shadow(color: .black.opacity(0.35), radius: 1.5)
        .padding(6)
        .background {
            if isSelected { Circle().fill(.white.opacity(0.85)) }
        }
    }

    /// The hull's size on screen in points, and the way it points; nil when the
    /// ship's length or heading isn't known
    private var hull: (length: Double, beam: Double, heading: Double)? {
        guard let length = ship.length, length > 0,
              let heading = course ?? ship.position?.course,
              metresPerPoint > 0 else { return nil }
        // Servers before the map sent widths: a typical laker's proportions
        let beam = ship.width.flatMap { $0 > 0 ? Double($0) : nil } ?? Double(length) * 0.14
        let small = ship.classB == true
        let minLength = small ? Self.minLengthClassB : Self.minLength
        let minBeam = small ? Self.minBeamClassB : Self.minBeam
        // Blown up evenly to the minimum length, then widened further if still too thin
        let scale = max(1 / metresPerPoint, minLength / Double(length))
        return (Double(length) * scale, max(beam * scale, minBeam), heading)
    }

    private var color: Color {
        if let direction = ship.approach?.direction { return Theme.color(for: direction) }
        return ship.classB == true ? .gray : Theme.signal
    }
}

/// A hull seen from above, bow at the top: square stern, straight sides, pointed bow
private struct HullShape: Shape {
    func path(in rect: CGRect) -> Path {
        let bowLength = min(rect.width, rect.height * 0.2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + bowLength))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + bowLength))
        path.closeSubpath()
        return path
    }
}

/// The tapped ship: name, type and speed, opening its details
private struct SelectedShipCard: View {
    var ship: Ship
    var close: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: ship.mmsi) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(ship.name)
                                .font(Theme.hull(.subheadline))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            if let flag = ship.flagEmoji { Text(flag) }
                        }
                        Text(details)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if let approach = ship.approach {
                        Text(Format.minutes(approach.etaMinutes))
                            .font(Theme.figure(.subheadline))
                            .foregroundStyle(Theme.signal)
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            Button("Close", systemImage: "xmark", action: close)
                .labelStyle(.iconOnly)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .card(padding: 12)
    }

    /// "Cargo · 225 m · 11.2 kn", or "at anchor"/"moored" when stopped
    private var details: String {
        var parts = [ship.summary].filter { !$0.isEmpty }
        if let position = ship.position {
            switch position.navStatus {
            case 1: parts.append("At anchor")
            case 5: parts.append("Moored")
            default:
                if let sog = position.sog { parts.append(Format.speed(sog)) }
            }
        }
        return parts.joined(separator: " · ")
    }
}
