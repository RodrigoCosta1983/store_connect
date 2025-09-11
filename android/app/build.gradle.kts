plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.rodrigocostadev.store_connect.store_connect"
    compileSdk = 35
    ndkVersion = "27.0.12077973"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "com.rodrigocostadev.store_connect.store_connect"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

repositories {
    google()
    mavenCentral()
    maven {
        url = uri("https://artifacts.mercadolibre.com/repository/android-releases/")
    }
}

dependencies {
  //  implementation(project(":mercado_pago_mobile_checkout"))
}

flutter {
    source = "../.."
}
