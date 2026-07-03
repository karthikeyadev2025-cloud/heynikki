# Nikki Mobile — Release Signing

Both stores require apps to be signed with a non-debug certificate before
upload. This doc covers Android (Play Store) and iOS (App Store / TestFlight).

## Android

### 1. Generate the upload keystore (once)

```bash
keytool -genkey -v -keystore ~/nikki-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias nikki-upload
```

You'll be prompted for a password — store it in a password manager. Losing
this keystore means you can never publish updates under the same Play
Store listing, so back it up to encrypted cloud storage.

### 2. Create `android/key.properties` (gitignored)

```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=nikki-upload
storeFile=/absolute/path/to/nikki-upload.jks
```

This file is **never committed** — confirm it's in `.gitignore`:

```bash
echo "android/key.properties" >> .gitignore
```

### 3. Wire signing into `android/app/build.gradle.kts`

Add above `android { ... }`:

```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) load(FileInputStream(f))
}
```

Inside `android { ... }`, add:

```kotlin
signingConfigs {
    create("release") {
        keyAlias      = keystoreProperties["keyAlias"]      as String?
        keyPassword   = keystoreProperties["keyPassword"]   as String?
        storeFile     = keystoreProperties["storeFile"]?.let { file(it as String) }
        storePassword = keystoreProperties["storePassword"] as String?
    }
}

buildTypes {
    release {
        signingConfig = signingConfigs.getByName("release")
        isMinifyEnabled  = true
        isShrinkResources = true
        proguardFiles(
            getDefaultProguardFile("proguard-android-optimize.txt"),
            "proguard-rules.pro",
        )
    }
}
```

### 4. Build a release AAB

```bash
flutter build appbundle --release
```

Output: `build/app/outputs/bundle/release/app-release.aab` — upload to Play Console.

### CI signing (GitHub Actions)

Base64-encode the keystore and store as a secret:

```bash
base64 < ~/nikki-upload.jks | pbcopy   # macOS
# or: base64 -w0 ~/nikki-upload.jks    # Linux
```

Set GitHub Actions secrets:
- `ANDROID_KEYSTORE_BASE64` — the base64 output
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_ALIAS`

Decode in the workflow:

```yaml
- name: Decode keystore
  run: echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > android/upload.jks
  env:
    ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
```

---

## iOS

### 1. Apple Developer account setup (one time)

You need a paid Apple Developer account (₹8,300/yr). Create:
- **App ID:** `in.nikki.app` (bundle identifier)
- **Distribution certificate** (one per team)
- **Provisioning profile** for App Store distribution

All three live in [App Store Connect](https://appstoreconnect.apple.com)
+ [Apple Developer portal](https://developer.apple.com/account).

### 2. Xcode configuration

Open `ios/Runner.xcworkspace` in Xcode. In **Runner target → Signing & Capabilities**:
- Team: select your team
- Bundle Identifier: `in.nikki.app`
- Toggle ON: "Automatically manage signing"

Xcode pulls the right provisioning profile automatically.

### 3. Build for App Store

```bash
flutter build ipa --release
```

Output: `build/ios/ipa/nikki.ipa` — upload via Transporter app or `xcrun altool`.

### CI signing (GitHub Actions, optional)

Use [`fastlane match`](https://docs.fastlane.tools/actions/match/) to sync
certs across machines without storing them in repo. The basic flow:

```bash
cd ios
bundle exec fastlane match appstore --readonly
bundle exec fastlane gym --scheme Runner --export_method app-store
```

Match stores certs in a private GitHub repo, encrypted with a password.

---

## App Store / Play Store assets checklist

Before submitting either store:

- [ ] App icon — 1024×1024 PNG (no transparency, no rounded corners)
- [ ] iOS launch screen — uses `assets/nikki-icon.svg` rendered
- [ ] Android adaptive icon — foreground + background separately
- [ ] Screenshots — 6.7" iPhone (1290×2796), 5.5" iPhone (1242×2208), tablet optional. Show: login, dashboard, calls list, setup, billing.
- [ ] Promotional graphic (Play Store) — 1024×500
- [ ] App description (en, te) — ≤ 4000 chars
- [ ] Privacy policy URL — `https://jovio.in/privacy` (already live)
- [ ] Data safety form (Play Console) — declare: account data, phone numbers (callers), audio recordings, all encrypted in transit, AES-256 at rest
- [ ] Export compliance (App Store) — declare uses of encryption (AES-256-GCM for recordings)

---

## Versioning

Bump in `pubspec.yaml`:

```yaml
version: 1.0.1+2
```

Format: `<marketing>+<build>`. Marketing = semver shown to users.
Build = monotonically increasing integer (Play Store + App Store both
reject re-uploads with the same build number).

Tag the release in git:

```bash
git tag v1.0.1
git push --tags
```
