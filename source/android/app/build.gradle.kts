// android/app/build.gradle.kts

import java.util.Properties

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

// Preview is debug-only and must not read production signing credentials.
val previewOnly = gradle.startParameter.taskNames.any { it.contains("Preview", ignoreCase = true) }
if (previewOnly && (project.findProperty("target") != "lib/previews/f10_feedback_main.dart" ||
    gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) })) {
    throw GradleException("Preview requires the offline f10_feedback_main.dart target and a debug build.")
}
val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties()
if (!previewOnly && !keyPropertiesFile.isFile) {
    throw GradleException("Release signing configuration is missing.")
}
try {
    if (!previewOnly) keyPropertiesFile.inputStream().use { keyProperties.load(it) }
} catch (_: Exception) {
    throw GradleException("Release signing configuration could not be loaded.")
}
fun requiredSigningProperty(name: String): String =
    keyProperties.getProperty(name)?.takeIf { it.isNotBlank() }
        ?: throw GradleException("Required release signing property is missing: $name")

android {
    namespace = "com.storeeconnect.app"
    compileSdk = 36
    ndkVersion = "27.0.12077973"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = "11"
    }

    signingConfigs {
        if (!previewOnly) create("release") {
            keyAlias = requiredSigningProperty("keyAlias")
            keyPassword = requiredSigningProperty("keyPassword")
            storeFile = file(requiredSigningProperty("storeFile"))
            storePassword = requiredSigningProperty("storePassword")
        }
    }

    defaultConfig {
        applicationId = "com.storeeconnect.app"
        minSdk = 24
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        multiDexEnabled = true
    }

    buildFeatures {
        buildConfig = true
    }

    flavorDimensions += "environment"
    productFlavors {
        create("preview") {
            dimension = "environment"
            applicationId = "com.storeeconnect.app.preview"
            versionNameSuffix = "-f10-preview"
        }
        create("hml") {
            dimension = "environment"
            applicationId = "com.storeeconnect.app"
        }
        create("prod") {
            dimension = "environment"
            applicationId = "com.storeeconnect.app"
        }
    }

    buildTypes {
        getByName("release") {
            if (!previewOnly) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}

// No Firebase configuration is supplied or processed for this offline flavor.
tasks.matching { it.name.contains("Preview") && it.name.endsWith("GoogleServices") }
    .configureEach { enabled = false }
tasks.matching { it.name.contains("PreviewRelease") }.configureEach { enabled = false }

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.multidex:multidex:2.0.1")
}
