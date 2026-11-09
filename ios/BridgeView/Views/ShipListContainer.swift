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
            .shipMenu(next)
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
            .shipMenu(ship, liveActivity: mode == .upcoming)
        }
    }
}

/// The next ship to reach the bridge, big, with a countdown
struct NextShipCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                        .minimumScaleFactor(0.6)
                    if let flag = ship.flagEmoji { Text(flag).font(.title3) }
                }
                if !ship.summary.isEmpty {
                    Text(ship.summary)
                        .font(.subheadline)
                        .opacity(0.75)
                }
            }
            // The time and distance go under the countdown at accessibility text sizes
            let figures = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(alignment: .lastTextBaseline))
            figures {
                countdown
                    .font(Theme.figure(.largeTitle, weight: .heavy))
                    .contentTransition(.numericText(countsDown: true))
                if !dynamicTypeSize.isAccessibilitySize {
                    Spacer()
                }
                VStack(alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
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
        // Read as one: the countdown's ticking seconds would otherwise be read out,
        // and "NM" letter by letter
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Next at the bridge: \(ship.name)")
        .accessibilityValue(accessibilityDetails)
        .accessibilityInputLabels([ship.name, "Next ship"])
        .accessibilityHint("Shows the ship's details")
    }

    /// "Canada. Upbound, heading north. Cargo, 225 metres. In 12 minutes, at 3:45 PM,
    /// 1.6 nautical miles away"
    private var accessibilityDetails: String {
        var sentences: [String] = []
        if let country = ship.flagCountry { sentences.append("Flag: \(country)") }
        var heading = approach.direction.label
        if let course = ship.position?.course { heading += ", \(Format.spokenCourse(course))" }
        sentences.append(heading)
        if !ship.summary.isEmpty { sentences.append(Format.spoken(ship.summary)) }
        let time = approach.eta.formatted(date: .omitted, time: .shortened)
        let when = approach.eta > .now ? "In \(Format.spokenMinutes(approach.etaMinutes)), at \(time)" : "At the bridge now"
        sentences.append("\(when), \(Format.spoken(Format.distance(approach.distanceNM))) away")
        return sentences.joined(separator: ". ")
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
struct ShipCamCard: View {
    var url: URL

    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 38

    var body: some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                Image(systemName: "video.fill")
                    .font(.body.weight(.bold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(width: iconSize, height: iconSize)
                    .background(Theme.signal.gradient, in: .rect(cornerRadius: 11))
                    .accessibilityHidden(true)
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
                    .accessibilityHidden(true)
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
