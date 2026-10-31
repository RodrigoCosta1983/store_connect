package com.storeeconnect.app

import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity: FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "store_connect/firebase_environment")
            .setMethodCallHandler { call, result ->
                if (call.method != "read") {
                    result.notImplemented()
                } else {
                    // Google Services generates these resources for the selected flavor.
                    // Dart verifies both IDs and the flavor before Firebase initialization.
                    val projectId = getString(R.string.project_id)
                    val appId = getString(R.string.google_app_id)
                    if (projectId.isBlank() || appId.isBlank()) {
                        result.error("ENVIRONMENT", "Native Firebase configuration missing.", null)
                    } else {
                        result.success(mapOf(
                            "flavor" to BuildConfig.FLAVOR,
                            "projectId" to projectId,
                            "appId" to appId
                        ))
                    }
                }
            }
    }
}
