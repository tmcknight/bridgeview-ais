import SwiftUI

/// The AIS feeds' credits from the server, each a link to its site. AISHub's
/// terms ask for "Data: AISHub contributors" clearly visible near the data.
struct DataCredits: View {
    var attribution: [Attribution]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(attribution.enumerated()), id: \.element) { index, credit in
                if index > 0 {
                    Text("·").foregroundStyle(.secondary)
                }
                Link(credit.text, destination: credit.url)
            }
        }
        .font(.caption)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity)
    }
}

#Preview {
    DataCredits(attribution: [
        Attribution(text: "Data: AISHub contributors", url: URL(string: "https://www.aishub.net")!),
        Attribution(text: "AISStream.io", url: URL(string: "https://aisstream.io")!),
    ])
}
