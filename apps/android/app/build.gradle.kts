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
        versionCode = 5
        versionName = "0.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { buildConfig = true }
    val buildRevision = System.getenv("ATHENA_ANDROID_BUILD_REVISION") ?: "local"
    require(buildRevision == "local" || Regex("[a-f0-9]{40}").matches(buildRevision))
    defaultConfig { buildConfigField("String", "BUILD_REVISION", "\"$buildRevision\"") }
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
            keyPassword = System.getenv("ATHENA_ANDROID_KEY_PASSWORD") ?: System.getenv("ATHENA_ANDROID_STORE_PASSWORD")
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
    implementation("com.google.android.material:material:1.14.0")
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.fragment:fragment:1.9.1")
    implementation("androidx.browser:browser:1.10.0")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("com.google.firebase:firebase-messaging:26.0.1")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
}
