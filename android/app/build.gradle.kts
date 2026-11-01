import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.play.publisher)
}

// App settings that aren't in the repo (like ios/Config/Local.xcconfig): from
// local.properties, else -P gradle properties, else environment variables
// (BRIDGEVIEW_API_URL for bridgeview.apiUrl, and so on)
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use(::load)
}

fun setting(name: String): String? {
    val env = name.replace('.', '_').replace(Regex("([a-z])([A-Z])"), "$1_$2").uppercase()
    return localProperties.getProperty(name)?.takeIf { it.isNotBlank() }
        ?: (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv(env)?.takeIf { it.isNotBlank() }
}

fun quoted(value: String?) = "\"${(value ?: "").replace("\\", "\\\\").replace("\"", "\\\"")}\""

val signingStore = setting("bridgeview.signing.storeFile")

android {
    namespace = "app.bridgeview"
    compileSdk = 37

    defaultConfig {
        applicationId = setting("bridgeview.applicationId") ?: "com.example.bridgeview"
        minSdk = 29
        targetSdk = 36
        // The release workflow passes the version from the tag (android-v1.2.0)
        versionName = setting("bridgeview.versionName") ?: "1.0"
        versionCode = setting("bridgeview.versionCode")?.toInt() ?: 1

        buildConfigField("String", "API_URL", quoted(setting("bridgeview.apiUrl") ?: "https://bridgeview.example.com"))
        // Firebase, for bridge alerts; without these the app works but gets no alerts
        buildConfigField("String", "FIREBASE_APP_ID", quoted(setting("bridgeview.firebase.appId")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(setting("bridgeview.firebase.apiKey")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(setting("bridgeview.firebase.projectId")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(setting("bridgeview.firebase.senderId")))
    }

    signingConfigs {
        if (signingStore != null) {
            create("release") {
                storeFile = file(signingStore)
                storePassword = setting("bridgeview.signing.storePassword")
                keyAlias = setting("bridgeview.signing.keyAlias")
                keyPassword = setting("bridgeview.signing.keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Google Play upload (the release workflow): internal testing track
play {
    setting("bridgeview.play.serviceAccountFile")?.let { serviceAccountCredentials.set(file(it)) }
    track.set(setting("bridgeview.play.track") ?: "internal")
    defaultToAppBundles.set(true)
    // With Play credentials, the version code is one more than the highest Play has (like iOS
    // build numbers); without them (local builds), bridgeview.versionCode or 1
    resolutionStrategy.set(
        if (setting("bridgeview.play.serviceAccountFile") != null) {
            com.github.triplet.gradle.androidpublisher.ResolutionStrategy.AUTO
        } else {
            com.github.triplet.gradle.androidpublisher.ResolutionStrategy.IGNORE
        },
    )
    // "draft" until the app's first release has been through review in the Play Console
    releaseStatus.set(com.github.triplet.gradle.androidpublisher.ReleaseStatus.valueOf((setting("bridgeview.play.releaseStatus") ?: "completed").uppercase()))
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.work.runtime)
    // Play services pull in an old Fragment, which breaks activity results
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.core.splashscreen)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.navigation.suite)
    implementation(libs.compose.material.icons)
    implementation(libs.firebase.messaging)
    implementation(libs.play.services.location)
    implementation(libs.maplibre)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
