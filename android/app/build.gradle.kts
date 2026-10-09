// android/app/build.gradle.kts

import java.util.Properties

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties()
if (!keyPropertiesFile.isFile) {
    throw GradleException("Release signing configuration is missing.")
}
try {
    keyPropertiesFile.inputStream().use { keyProperties.load(it) }
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
        create("release") {
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
        versionCode = 49
        versionName = "1.0.6"
        multiDexEnabled = true
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.multidex:multidex:2.0.1")
}
