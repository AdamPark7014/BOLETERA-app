plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "mx.boletera.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "mx.boletera.mobile"
        minSdk = 24
        targetSdk = 36
        versionCode = (project.findProperty("VERSION_CODE") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("VERSION_NAME") as String?) ?: "1.0.0"

        // La URL del API se inyecta en compilación: un APK de desarrollo no debe
        // poder apuntar a producción por descuido, ni al revés.
        buildConfigField(
            "String",
            "API_BASE_URL",
            "\"${project.findProperty("API_BASE_URL") ?: "http://10.0.2.2:4001/api/v1"}\"",
        )
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.02.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.0")
    implementation("androidx.navigation:navigation-compose:2.9.0")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3:1.3.2")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // La clave de firma de cada boleto ES la credencial de entrada: se guarda
    // cifrada, nunca en SharedPreferences a secas.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.datastore:datastore-preferences:1.1.7")

    // Generación del QR en el dispositivo. Sin esto habría que pedirle la imagen
    // al servidor, que es justo lo que impide funcionar sin cobertura.
    implementation("com.google.zxing:core:3.5.3")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    testImplementation("junit:junit:4.13.2")
}
