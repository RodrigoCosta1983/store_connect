package com.storeeconnect.app.preview

import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine

// No Firebase environment channel, login or production navigation.
class PreviewActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        // Intentionally do not call the production GeneratedPluginRegistrant.
        // Only private app-directory discovery and bundled SQLite are needed.
        flutterEngine.plugins.add(io.flutter.plugins.pathprovider.PathProviderPlugin())
        flutterEngine.plugins.add(eu.simonbinder.sqlite3_flutter_libs.Sqlite3FlutterLibsPlugin())
    }
}
