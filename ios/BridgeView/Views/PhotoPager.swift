import SwiftUI

/// A ship's photos, swiped one at a time. Swiping on from the last photo comes round
/// to the first, and back from the first to the last.
///
/// The pages are a copy of the last photo, every photo, then a copy of the first; when
/// a swipe settles on a copy, the pager jumps (unanimated) to the photo it copies.
struct PhotoPager<Page: View>: View {
    var photos: [VesselPhoto]
    @Binding var index: Int
    /// Stops swiping, e.g. while a photo is zoomed in
    var swipeDisabled = false
    @ViewBuilder var page: (VesselPhoto) -> Page

    @State private var position: Int?

    private var count: Int { photos.count }
    /// Copies at each end only when there's more than one photo to come round to
    private var wraps: Bool { count > 1 }
    private var pageCount: Int { wraps ? count + 2 : count }

    private func photoIndex(forSlot slot: Int) -> Int {
        wraps ? (slot - 1 + count) % count : slot
    }

    private func slot(forPhoto index: Int) -> Int {
        let index = min(max(index, 0), max(count - 1, 0))
        return wraps ? index + 1 : index
    }

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(0..<pageCount, id: \.self) { slot in
                    page(photos[photoIndex(forSlot: slot)])
                        .containerRelativeFrame([.horizontal, .vertical])
                        .clipped()
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollIndicators(.never)
        .scrollPosition(id: $position)
        .scrollDisabled(!wraps || swipeDisabled)
        .onAppear { position = slot(forPhoto: index) }
        .onChange(of: count) { jump(to: slot(forPhoto: index)) }
        .onChange(of: position) {
            guard let position, count > 0 else { return }
            let shown = photoIndex(forSlot: position)
            if shown != index { index = shown }
        }
        // Set from outside, e.g. by the full-screen viewer
        .onChange(of: index) {
            guard count > 0, position.map({ photoIndex(forSlot: $0) }) != index else { return }
            jump(to: slot(forPhoto: index))
        }
        // Come round from a copy at either end to the photo it copies
        .onScrollPhaseChange { _, phase in
            guard phase == .idle, wraps, let position else { return }
            if position == 0 {
                jump(to: count)
            } else if position == count + 1 {
                jump(to: 1)
            }
        }
    }

    private func jump(to slot: Int) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { position = slot }
    }
}

/// A ship's photos full screen: swipe through them, pinch or double-tap to zoom in
struct PhotoViewer: View {
    var photos: [VesselPhoto]
    var title: String
    @Binding var index: Int

    @Environment(\.dismiss) private var dismiss
    @State private var zoomed = false

    private var current: VesselPhoto? {
        photos.isEmpty ? nil : photos[min(index, photos.count - 1)]
    }

    var body: some View {
        NavigationStack {
            PhotoPager(photos: photos, index: $index, swipeDisabled: zoomed) { photo in
                ZoomablePhoto(url: photo.url, zoomed: $zoomed)
            }
            .overlay(alignment: .bottom) {
                VStack(spacing: 4) {
                    if photos.count > 1 {
                        Text("\(index + 1) / \(photos.count)")
                            .monospacedDigit()
                            .font(.caption.weight(.semibold))
                    }
                    if let credit = current?.credit {
                        Text(credit)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.75))
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .accessibilityLabel("Photo: \(credit)")
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal)
                .padding(.bottom, 8)
                .opacity(zoomed ? 0 : 1)
                .animation(.easeInOut(duration: 0.2), value: zoomed)
                .allowsHitTesting(false)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle(title)
            .toolbarTitleDisplayMode(.inline)
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
                if let pageUrl = current?.pageUrl {
                    ToolbarItem(placement: .topBarLeading) {
                        Link(destination: pageUrl) {
                            Image(systemName: "info.circle")
                        }
                        .accessibilityLabel("View on Wikimedia Commons")
                    }
                }
            }
        }
        .environment(\.colorScheme, .dark)
    }
}

/// One photo, fitted to the screen; pinch or double-tap to zoom in, drag to look around
private struct ZoomablePhoto: View {
    var url: URL
    /// Whether this (or any) photo is zoomed in, so the pager stops swiping
    @Binding var zoomed: Bool

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    private static let maxScale: CGFloat = 5
    private static let doubleTapScale: CGFloat = 2.5

    var body: some View {
        GeometryReader { geometry in
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    Image(systemName: "photo")
                        .font(.largeTitle)
                        .foregroundStyle(.white.opacity(0.4))
                default:
                    ProgressView().tint(.white)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .scaleEffect(scale)
            .offset(offset)
            .contentShape(.rect)
            .gesture(
                MagnifyGesture()
                    .onChanged { value in
                        scale = min(max(lastScale * value.magnification, 1), Self.maxScale)
                        offset = clamped(lastOffset, in: geometry.size)
                        zoomed = scale > 1
                    }
                    .onEnded { _ in
                        if scale < 1.05 {
                            reset()
                        } else {
                            lastScale = scale
                            lastOffset = offset
                        }
                    }
            )
            // Only while zoomed in; otherwise the drag swipes to the next photo
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        offset = clamped(
                            CGSize(
                                width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height
                            ),
                            in: geometry.size
                        )
                    }
                    .onEnded { _ in lastOffset = offset },
                including: scale > 1 ? .all : .subviews
            )
            .onTapGesture(count: 2) { location in
                withAnimation(.spring(duration: 0.3)) {
                    if scale > 1 {
                        reset()
                    } else {
                        scale = Self.doubleTapScale
                        lastScale = scale
                        // Zoom in on the spot tapped
                        let centre = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
                        offset = clamped(
                            CGSize(
                                width: (centre.x - location.x) * (scale - 1),
                                height: (centre.y - location.y) * (scale - 1)
                            ),
                            in: geometry.size
                        )
                        lastOffset = offset
                        zoomed = true
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Photo")
        .accessibilityAddTraits(.isImage)
        .accessibilityAction(named: scale > 1 ? "Zoom out" : "Zoom in") {
            withAnimation {
                if scale > 1 {
                    reset()
                } else {
                    scale = Self.doubleTapScale
                    lastScale = scale
                    zoomed = true
                }
            }
        }
        // Swiped away (only possible zoomed out) or the viewer closed
        .onDisappear {
            scale = 1
            lastScale = 1
            offset = .zero
            lastOffset = .zero
        }
    }

    /// Keeps the zoomed photo covering the screen as far as it can
    private func clamped(_ offset: CGSize, in size: CGSize) -> CGSize {
        let maxX = size.width * (scale - 1) / 2
        let maxY = size.height * (scale - 1) / 2
        return CGSize(
            width: min(max(offset.width, -maxX), maxX),
            height: min(max(offset.height, -maxY), maxY)
        )
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
        zoomed = false
    }
}
