import SwiftUI

/// The AIS feeds' credits from the server, each a link to its site. AISHub's
/// terms ask for "Data: AISHub contributors" clearly visible near the data.
struct DataCredits: View {
    var attribution: [Attribution]
    /// Centred under maps and lists; leading in a form, where a centred row
    /// pulls the list separator below it in to where its text starts
    var alignment: Alignment = .center

    var body: some View {
        // One line; one credit to a line where that doesn't fit (large text)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                ForEach(Array(attribution.enumerated()), id: \.element) { index, credit in
                    if index > 0 {
                        Text("·").foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                    }
                    Link(credit.text, destination: credit.url)
                }
            }
            .lineLimit(1)
            VStack(alignment: alignment.horizontal, spacing: 4) {
                ForEach(attribution, id: \.self) { credit in
                    Link(credit.text, destination: credit.url)
                }
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .tint(.secondary)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, alignment: alignment)
    }
}

#Preview {
    DataCredits(attribution: [
        Attribution(text: "Data: AISHub contributors", url: URL(string: "https://www.aishub.net")!),
        Attribution(text: "AISStream.io", url: URL(string: "https://aisstream.io")!),
    ])
}
