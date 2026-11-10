import SwiftUI

/// Star that keeps a ship in Favourites, or takes it out
struct FavouriteButton: View {
    @Environment(Favourites.self) private var favourites

    var mmsi: Int
    var name: String

    var body: some View {
        let on = favourites.contains(mmsi)
        Button {
            favourites.toggle(mmsi: mmsi, name: name)
        } label: {
            Image(systemName: "star")
                .symbolVariant(on ? .fill : .none)
                .contentTransition(.symbolEffect(.replace))
                .foregroundStyle(on ? AnyShapeStyle(Theme.signal) : AnyShapeStyle(.secondary))
                .font(.body.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: on)
        .accessibilityLabel("Favourite")
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityInputLabels([Text("Favourite"), Text("Star")])
        .accessibilityHint(on ? Text("Takes \(name) out of Favourites") : Text("Keeps \(name) in Favourites"))
    }
}
