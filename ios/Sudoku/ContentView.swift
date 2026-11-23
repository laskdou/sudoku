import SwiftUI
import WebKit

struct ContentView: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        SudokuWebView()
            .ignoresSafeArea()
            .background(
                colorScheme == .dark
                    ? Color(red: 19/255, green: 21/255, blue: 20/255)
                    : Color(red: 242/255, green: 239/255, blue: 233/255)
            )
    }
}

private struct SudokuWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
