// Buildscript para plugins
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.0.2")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.8.10")
        classpath("com.google.gms:google-services:4.3.15") // FlutterFire
    }
}

// Repositórios globais
allprojects {
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("https://artifacts.mercadolibre.com/repository/android-releases/")
        }
    }
}
