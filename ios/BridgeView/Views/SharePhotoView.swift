import PhotosUI
import SwiftUI

/// Take or choose a photo of a ship and send it to BridgeView, where it waits
/// for approval before it's shown. The sharer keeps their copyright and
/// licenses it to BridgeView (terms.html); it's credited to the name they
/// give, or to no one.
struct SharePhotoView: View {
    var mmsi: Int
    var shipName: String

    @Environment(\.dismiss) private var dismiss
    @AppStorage("photoCreditName") private var credit = ""
    @State private var image: UIImage?
    @State private var pickerItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var note = ""
    @State private var agreed = false
    @State private var sending = false
    @State private var error: String?
    @State private var sent = false

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            Group {
                if sent {
                    ContentUnavailableView {
                        Label("Thanks!", systemImage: "checkmark.circle.fill")
                    } description: {
                        Text("Your photo of \(shipName) will show once it's been checked.")
                    } actions: {
                        Button("Done") { dismiss() }
                            .prominentGlassButton()
                    }
                } else {
                    form
                }
            }
            .navigationTitle("Share a photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !sent {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if sending {
                            ProgressView()
                        } else {
                            Button("Send") { Task { await send() } }
                                .disabled(image == nil || !agreed)
                        }
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker(image: $image)
                .ignoresSafeArea()
        }
        .onChange(of: pickerItem) { _, item in
            Task { await load(item) }
        }
        .interactiveDismissDisabled(sending)
    }

    private var form: some View {
        Form {
            Section {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 260)
                        .clipShape(.rect(cornerRadius: 8))
                        .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                        .accessibilityLabel("The photo you chose")
                }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button(image == nil ? "Take a photo" : "Take another", systemImage: "camera") {
                        showCamera = true
                    }
                }
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    Label(image == nil ? "Choose from your photos" : "Choose another", systemImage: "photo.on.rectangle")
                }
            } header: {
                Text(shipName)
            } footer: {
                Text("A clear shot of the ship works best. Where it was taken and which camera took it are removed before it's sent.")
            }

            Section {
                TextField("Your name (optional)", text: $credit)
                    .textContentType(.name)
                    .autocorrectionDisabled()
            } header: {
                Text("Credit")
            } footer: {
                Text("Shown with your photo. Leave it empty and the photo isn't credited.")
            }

            Section {
                TextField("Anything we should know? (optional)", text: $note, axis: .vertical)
                    .lineLimit(1...4)
            } header: {
                Text("Note")
            } footer: {
                Text("Only BridgeView sees this.")
            }

            Section {
                Toggle(isOn: $agreed) {
                    Text("I took this photo. I keep the copyright, and let BridgeView use it in the app, on its website and anywhere else BridgeView appears, for free and for good.")
                        .font(.subheadline)
                }
                Link("Read the terms", destination: AppConfig.apiURL.appending(path: "api/pages/terms.html"))
            } footer: {
                Text("Photos are checked before they appear, and may not be used. Sending photos that aren't yours, or that aren't of ships, can get you blocked from sharing.")
            }

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
        }
        .riverListBackground()
    }

    private func load(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            if let data = try await item.loadTransferable(type: Data.self), let picked = UIImage(data: data) {
                image = picked
                error = nil
            } else {
                error = "Couldn't open that photo. Try another."
            }
        } catch {
            self.error = "Couldn't open that photo. Try another."
        }
    }

    private func send() async {
        if let image, !SharedPhoto.isBigEnough(image) {
            error = "That photo is too small. Share a bigger one."
            return
        }
        guard let image, let jpeg = SharedPhoto.jpeg(from: image) else {
            error = "Couldn't prepare that photo. Try another."
            return
        }
        sending = true
        defer { sending = false }
        do {
            try await api.sharePhoto(
                mmsi: mmsi,
                jpeg: jpeg,
                credit: credit.trimmingCharacters(in: .whitespacesAndNewlines),
                note: note.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            error = nil
            sent = true
        } catch {
            self.error = APIError.message(for: error)
        }
    }
}

/// The camera, for taking a photo to share
private struct CameraPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    @MainActor final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let photo = info[.originalImage] as? UIImage { parent.image = photo }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
