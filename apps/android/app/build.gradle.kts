plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.athena.android"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.athena.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    val releaseKeystore = System.getenv("ATHENA_ANDROID_KEYSTORE")
    if (!releaseKeystore.isNullOrBlank()) signingConfigs {
        create("athenaRelease") {
            storeFile = file(releaseKeystore)
            storePassword = System.getenv("ATHENA_ANDROID_STORE_PASSWORD")
            keyAlias = System.getenv("ATHENA_ANDROID_KEY_ALIAS") ?: "athena"
            keyPassword = System.getenv("ATHENA_ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (!releaseKeystore.isNullOrBlank()) signingConfig = signingConfigs.getByName("athenaRelease")
        }
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.fragment:fragment:1.8.6")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.google.firebase:firebase-messaging:25.0.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
