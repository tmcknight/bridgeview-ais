import MapKit
import SwiftUI

/// Every ship near the bridge on a map, moved along its course between updates
struct LiveMapView: View {
    static let pollInterval: Duration = .seconds(5)

    @State private var snapshot: MapSnapshot?
    @State private var error: String?
    @State private var selected: Int?
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(
        center: Bridge.center, latitudinalMeters: 9000, longitudinalMeters: 9000
    ))

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            // Redrawn a couple of times a second so moving ships glide between reports
            TimelineView(.animation(minimumInterval: 0.5)) { context in
                // No rotating: the ship markers point north-up
                Map(position: $camera, interactionModes: [.pan, .zoom]) {
                    Marker(Bridge.name, systemImage: "road.lanes", coordinate: Bridge.center)
                        .tint(.gray)
                    ForEach(ships) { ship in
                        if let position = ship.position {
                            Annotation(ship.name, coordinate: position.coordinate(at: context.date), anchor: .center) {
                                MapShipMarker(ship: ship, isSelected: ship.mmsi == selected)
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
            }
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
                snapshot = try await api.map()
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

/// A ship on the map: an arrow along its heading when under way, a dot when not.
/// Ships heading for the bridge take their direction's colour.
private struct MapShipMarker: View {
    var ship: Ship
    var isSelected: Bool

    var body: some View {
        let small = ship.classB == true
        Group {
            if let position = ship.position, position.isUnderWay, let course = position.course {
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
        // A bigger target than the arrow, so small ships are easy to tap
        .contentShape(.circle)
        .accessibilityLabel(ship.name)
        .accessibilityAddTraits(.isButton)
    }

    private var color: Color {
        if let direction = ship.approach?.direction { return Theme.color(for: direction) }
        return ship.classB == true ? .gray : Theme.signal
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
