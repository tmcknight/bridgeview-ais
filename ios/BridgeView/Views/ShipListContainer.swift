import SwiftUI

/// List of ships from the bridge snapshot, with loading, empty and error states
struct ShipListContainer<Empty: View>: View {
    @Environment(BridgeStore.self) private var store

    var title: String
    var ships: [Ship]?
    var mode: ShipRow.Mode
    /// Shown on "Coming up" under the next ship and in the toolbar
    var shipCam: URL? = nil
    @ViewBuilder var empty: () -> Empty

    var body: some View {
        NavigationStack {
            Group {
                if let ships, !ships.isEmpty {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            content(ships)
                        }
                        .padding(.horizontal)
                        .padding(.bottom)
                    }
                } else if ships == nil, let error = store.error {
                    ContentUnavailableView {
                        Label("Can't reach BridgeView", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await store.refresh() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if ships == nil {
                    ProgressView()
                } else {
                    ScrollView { empty() }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { RiverBackground() }
            .refreshable { await store.refresh() }
            .navigationTitle(title)
            .toolbar {
                if let shipCam {
                    ToolbarItem(placement: .topBarTrailing) {
                        Link(destination: shipCam) {
                            Label("Port Huron ship cam", systemImage: "video.fill")
                        }
                    }
                }
            }
            .navigationDestination(for: Int.self) { mmsi in
                ShipDetailView(mmsi: mmsi)
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 0) {
                    if ships != nil, let error = store.error {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .padding(8)
                            .frame(maxWidth: .infinity)
                    }
                    if let attribution = store.snapshot?.attribution, !attribution.isEmpty {
                        DataCredits(attribution: attribution)
                            .padding(.horizontal)
                            .padding(.vertical, 6)
                    }
                }
                .background(.thinMaterial)
            }
        }
    }

    @ViewBuilder private func content(_ ships: [Ship]) -> some View {
        if mode == .upcoming, let next = ships.first, let approach = next.approach {
            NavigationLink(value: next.mmsi) {
                NextShipCard(ship: next, approach: approach)
            }
            .buttonStyle(.plain)
            if let shipCam {
                ShipCamCard(url: shipCam)
            }
            if ships.count > 1 {
                SectionLabel("After that")
                    .padding(.top, 8)
            }
            rows(ships.dropFirst())
        } else {
            rows(ships[...])
        }
    }

    private func rows(_ ships: ArraySlice<Ship>) -> some View {
        ForEach(ships) { ship in
            NavigationLink(value: ship.mmsi) {
                ShipRow(ship: ship, mode: mode)
                    .card(padding: 12)
            }
            .buttonStyle(.plain)
        }
    }
}

/// The next ship to reach the bridge, big, with a countdown and how far it has to go
struct NextShipCard: View {
    var ship: Ship
    var approach: Approach

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("NEXT AT THE BRIDGE")
                    .font(.caption.weight(.bold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.signalOnRiver)
                Spacer()
                Label {
                    Text(approach.direction.label)
                } icon: {
                    DirectionArrow(direction: approach.direction, course: ship.position?.course)
                }
                .font(.caption.weight(.bold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.white.opacity(0.14), in: .capsule)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ship.name)
                        .font(Theme.hull(.title2))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if let flag = ship.flagEmoji { Text(flag).font(.title3) }
                }
                if !ship.summary.isEmpty {
                    Text(ship.summary)
                        .font(.subheadline)
                        .opacity(0.75)
                }
            }
            HStack(alignment: .lastTextBaseline) {
                countdown
                    .font(Theme.figure(.largeTitle, weight: .heavy))
                    .contentTransition(.numericText(countsDown: true))
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(approach.eta, style: .time)
                        .font(Theme.figure(.headline))
                    Text(Format.distance(approach.distanceNM))
                        .font(.subheadline)
                        .opacity(0.75)
                }
            }
            ApproachGauge(etaMinutes: approach.etaMinutes)
        }
        .padding(18)
        .foregroundStyle(.white)
        .background {
            ZStack {
                LinearGradient(colors: [Theme.shallows, Theme.river], startPoint: .topTrailing, endPoint: .bottomLeading)
                Image(systemName: "water.waves")
                    .font(.system(size: 160, weight: .ultraLight))
                    .foregroundStyle(.white.opacity(0.06))
                    .offset(x: 110, y: 30)
            }
            .clipShape(.rect(cornerRadius: Theme.cornerRadius + 4))
        }
        .shadow(color: Theme.river.opacity(0.35), radius: 14, y: 8)
        .padding(.top, 4)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows the ship's details")
    }

    @ViewBuilder private var countdown: some View {
        if approach.eta > .now {
            Text(timerInterval: Date.now...approach.eta, countsDown: true)
        } else {
            Text("Now")
        }
    }
}

/// Link to the Port Huron ship cam, to watch the next ship go under the bridge
private struct ShipCamCard: View {
    var url: URL

    var body: some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                Image(systemName: "video.fill")
                    .font(.body.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(Theme.signal.gradient, in: .rect(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Watch it pass")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text("Port Huron ship cam, live")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .multilineTextAlignment(.leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .card(padding: 12)
    }
}

/// The river from three hours out to the bridge, with the ship along it
private struct ApproachGauge: View {
    /// Ships are listed up to three hours out
    static let span = 180.0

    var etaMinutes: Double

    var body: some View {
        let progress = 1 - min(max(etaMinutes / Self.span, 0), 1)
        HStack(spacing: 8) {
            GeometryReader { geometry in
                let width = geometry.size.width
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(.white.opacity(0.18))
                        .frame(height: 4)
                    Capsule()
                        .fill(Theme.signalOnRiver)
                        .frame(width: max(width * progress, 4), height: 4)
                    Image(systemName: "ferry.fill")
                        .font(.caption)
                        .foregroundStyle(Theme.signalOnRiver)
                        .offset(x: min(max(width * progress - 9, 0), width - 18), y: -11)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 24)
            Image(systemName: "road.lanes")
                .font(.caption.weight(.bold))
                .opacity(0.85)
        }
        .accessibilityHidden(true)
    }
}

struct UpcomingView: View {
    @Environment(BridgeStore.self) private var store

    var body: some View {
        ShipListContainer(
            title: "Coming up",
            ships: store.snapshot?.upcoming,
            mode: .upcoming,
            shipCam: ShipLinks.shipCam(videoId: store.snapshot?.shipCamVideoId)
        ) {
            ContentUnavailableView(
                "No ships heading for the bridge",
                systemImage: "water.waves",
                description: Text("Ships show here up to three hours before they reach the \(Bridge.name).")
            )
        }
    }
}

struct RecentView: View {
    @Environment(BridgeStore.self) private var store

    var body: some View {
        ShipListContainer(title: "Recently passed", ships: store.snapshot?.recent, mode: .recent) {
            ContentUnavailableView(
                "No ships in the last day",
                systemImage: "clock",
                description: Text("Ships that go under the \(Bridge.name) show here for 24 hours.")
            )
        }
    }
}
