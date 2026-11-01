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
                            // At the end of the list, out of the way but still beside the data
                            if let attribution = store.snapshot?.attribution, !attribution.isEmpty {
                                DataCredits(attribution: attribution)
                                    .padding(.top, 8)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.bottom)
                        .readableWidth()
                    }
                } else if ships == nil, let error = store.error {
                    ContentUnavailableView {
                        Label("Can't reach BridgeView", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await store.refresh() } }
                            .prominentGlassButton()
                    }
                } else if ships == nil {
                    ProgressView()
                } else {
                    // A little down from the title, not jammed against it
                    ScrollView { empty().padding(.top, 72) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { RiverBackground() }
            .refreshable { await store.refresh() }
            .navigationTitle(title)
            // Big title in the bar, beside its buttons, not on a row of its own
            .toolbarTitleDisplayMode(.inlineLarge)
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
                // Small glass pills floating over the list, above the tab bar
                VStack(spacing: 6) {
                    if ships != nil, let error = store.error {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .glassPill()
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 4)
                .readableWidth()
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

/// The next ship to reach the bridge, big, with a countdown
struct NextShipCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                .glassPill(clear: true)
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
        }
        .padding(18)
        .foregroundStyle(.white)
        .background {
            ZStack {
                LinearGradient(colors: [Theme.shallows, Theme.river], startPoint: .topTrailing, endPoint: .bottomLeading)
                TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
                    Swells(time: reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate)
                        .stroke(.white.opacity(0.1), lineWidth: 1)
                }
                .frame(height: 90)
                .padding(.bottom, 8)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .accessibilityHidden(true)
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
                description: Text("When a ship is within three hours of the \(Bridge.name), it'll show up here with a countdown.")
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
                description: Text("Ships stay here for a day after they go under the \(Bridge.name).")
            )
        }
    }
}
