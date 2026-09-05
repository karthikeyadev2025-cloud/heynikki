# Hey Nikki — phone app

One app, one login. The role on `tenant_users` decides where it opens:
owner → Reception (`/dashboard`), member/support → Human Desk (`/desk`).

The app is a Capacitor shell around the live dashboard (`server.url =
https://www.heynikki.in`, so web deploys reach the app instantly) plus one
native piece the browser cannot do: an always-on **“Hey Nikki”** listener.

```
mic → sherpa-onnx keyword spotter ─("Hey Nikki")→ chime + "చెప్పండి"
    → record the question (energy VAD) → POST /api/app/voice-query
    → play Nikki's answer → back to listening
```

* `android/app/src/main/java/in/heynikki/app/HeyNikkiPlugin.java` — JS bridge
  (`start/stop/status/requestPermission/forget`), used by `web/lib/native.ts`.
* `HeyNikkiService.java` — microphone foreground service that owns the loop.
* `assets/kws/` — 3.3 M-param zipformer KWS model (int8) + `keywords.txt`
  with the BPE spellings of "Hey Nikki" we accept. Add a line per new
  pronunciation; tokenise with `bpe.model` from the sherpa-onnx model dir.
* `res/raw/cheppandi.wav` — Sarvam TTS (priya) "చెప్పండి"; `chime.wav`.
* Auth to the API is a per-device token (`POST /api/app/device-token`,
  table `app_device_tokens`), minted by the web layer on first "Hey Nikki"
  toggle and revoked on sign-out.

## Build

```
./fetch-sherpa.sh                 # once: 120 MB AAR into android/app/libs (not in git)
cd android
JAVA_HOME=~/tools/jdk-17* ANDROID_HOME=~/tools/android-sdk ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Sign-in inside the app: email/password or phone OTP. Google sign-in does not
work in a WebView (Google blocks it); that needs a native Google plugin later.

## Known limits

* Android 14 will not let a microphone service start itself after a reboot —
  the owner opens the app once and it resumes.
* iOS cannot run third-party wake words in the background; the plan there is
  a Siri Shortcut ("Hey Siri, Nikki") that opens the app straight into the
  voice assistant.
