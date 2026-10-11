package com.storeeconnect.app

import com.google.firebase.FirebaseOptions
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
                    val options = FirebaseOptions.fromResource(this)
                    if (options == null) {
                        result.error("ENVIRONMENT", "Native Firebase configuration missing.", null)
                    } else {
                        result.success(mapOf(
                            "flavor" to BuildConfig.FLAVOR,
                            "projectId" to options.projectId,
                            "appId" to options.applicationId
                        ))
                    }
                }
            }
    }
}