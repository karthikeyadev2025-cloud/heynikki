package in.heynikki.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.util.Log;

import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotter;
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotterResult;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStreamReader;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.regex.Pattern;
import java.util.concurrent.TimeUnit;

/**
 * The always-on listener. One worker thread owns the microphone:
 *
 *   mic → sherpa-onnx keyword spotter ─(“Hey Nikki”)→ chime + “చెప్పండి”
 *       → record the owner's question (energy VAD) → POST /api/app/voice-query
 *       → play Nikki's answer → back to spotting.
 *
 * Runs as a microphone foreground service so Android keeps it alive with the
 * screen off. The device token and API base come from SharedPreferences so a
 * START_STICKY restart needs nothing from the web layer.
 */
public class HeyNikkiService extends Service {
    static final String TAG = "HeyNikki";
    static final String ACTION_START = "in.heynikki.app.START";
    static final String ACTION_STOP = "in.heynikki.app.STOP";
    static final String CHANNEL = "heynikki_listener";
    static final int NOTIF_ID = 1;
    static final int SAMPLE_RATE = 16000;

    private static volatile boolean running = false;
    private static volatile String state = "idle";

    private Thread worker;
    private NikkiHud hud;
    private volatile boolean stopRequested = false;
    private PowerManager.WakeLock wakeLock;

    /** After she answers, the mic stays open this long for a follow-up
     *  (no wake word needed), for up to this many extra turns. */
    static final int FOLLOW_UP_WAIT_MS = 4000;
    static final int MAX_FOLLOW_UPS = 6;
    /** "Hey Nikki" said again inside the conversation: not a question. */
    private static final Pattern JUST_WAKE = Pattern.compile(
        "^[\\s\\p{Punct}]*(hey|hai|hi|హే|హాయ్|हे|हाय)?[\\s\\p{Punct}]*(nikki|nicky|niki|nikky|నిక్కీ|నిక్కి|निक्की|निकी)[\\s\\p{Punct}]*$",
        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    // Debug builds keep the last 12 s of mic audio so the wake word can be
    // tuned on the owner's real voice:
    //   adb shell am broadcast -a in.heynikki.app.DUMP_MIC -p in.heynikki.app
    //   adb shell run-as in.heynikki.app cat cache/mic_dump.wav > mic_dump.wav
    static final String ACTION_DUMP_MIC = "in.heynikki.app.DUMP_MIC";
    private final short[] ring = new short[SAMPLE_RATE * 12];
    private volatile int ringPos = 0;
    private volatile boolean ringFull = false;
    private BroadcastReceiver dumpReceiver;

    static boolean isRunning() { return running; }
    static String stateName() { return state; }

    /** On by default from first launch; the owner can switch it off. A token
     *  is not required — without one Nikki answers as the product guide. */
    static boolean isEnabled(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        return p.getBoolean("enabled", true);
    }

    /** Start the listener if the owner has it switched on and it is not up. */
    static void startIfEnabled(Context ctx) {
        if (!isEnabled(ctx) || running) return;
        Intent i = new Intent(ctx, HeyNikkiService.class).setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        SharedPreferences p = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        if (ACTION_STOP.equals(action) || !isEnabled(this)) {
            shutdown();
            return START_NOT_STICKY;
        }
        ensureChannel();
        if (hud == null) hud = new NikkiHud(this);
        Notification n = buildNotification(idleText());
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NOTIF_ID, n);
        } catch (Exception refused) {
            // Android 14+: a microphone service may only start from a visible
            // activity. Leave a one-tap way back instead of crashing.
            Log.w(TAG, "foreground start refused", refused);
            nudge(this, "Tap to switch Nikki back on");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (dumpReceiver == null && (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            dumpReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) { dumpMic(); }
            };
            IntentFilter f = new IntentFilter(ACTION_DUMP_MIC);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(dumpReceiver, f, Context.RECEIVER_EXPORTED);
            else registerReceiver(dumpReceiver, f);
        }
        if (worker == null || !worker.isAlive()) {
            stopRequested = false;
            worker = new Thread(this::loop, "heynikki-listener");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (dumpReceiver != null) { try { unregisterReceiver(dumpReceiver); } catch (Throwable ignored) {} dumpReceiver = null; }
        stopRequested = true;
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    private void shutdown() {
        if (hud != null) hud.hide(0);
        stopRequested = true;
        running = false;
        state = "idle";
        stopForeground(true);
        stopSelf();
    }

    // ───────────────────────── main loop ─────────────────────────

    private void loop() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "heynikki:listener");
        wakeLock.acquire();
        running = true;

        KeywordSpotter spotter = null;
        OnlineStream stream = null;
        AudioRecord rec = null;
        try {
            spotter = new KeywordSpotter(getAssets(), kwsConfig());
            stream = spotter.createStream("");
            rec = openMic();
            rec.startRecording();
            setState("listening", idleText());

            short[] buf = new short[SAMPLE_RATE / 10]; // 100 ms
            float[] f = new float[buf.length];
            int silentFrames = 0;
            while (!stopRequested) {
                int n = rec.read(buf, 0, buf.length);
                if (n <= 0) continue;
                // A service the OS restarted in the background gets a muted
                // mic (pure zeros) on Android 11+. Ten seconds of that means
                // nobody will ever be heard: hand over to the one-tap nudge.
                int peak = 0;
                for (int i = 0; i < n; i++) { int a = Math.abs(buf[i]); if (a > peak) peak = a; }
                if (peak == 0) { if (++silentFrames >= 100) throw new IllegalStateException("microphone muted by the system"); }
                else silentFrames = 0;
                for (int i = 0; i < n; i++) { ring[ringPos] = buf[i]; if (++ringPos == ring.length) { ringPos = 0; ringFull = true; } }
                for (int i = 0; i < n; i++) f[i] = buf[i] / 32768f;
                stream.acceptWaveform(n == f.length ? f : java.util.Arrays.copyOf(f, n), SAMPLE_RATE);
                while (spotter.isReady(stream)) spotter.decode(stream);
                KeywordSpotterResult r = spotter.getResult(stream);
                if (r.getKeyword() != null && !r.getKeyword().isEmpty()) {
                    Log.i(TAG, "wake word: " + r.getKeyword());
                    spotter.reset(stream);
                    rec.stop();
                    buzz();
                    handleWake();
                    rec.startRecording();
                    setState("listening", idleText());
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "listener died", t);
            // Whatever it was (permission pulled, muted mic, model missing),
            // sitting here as a dead foreground service helps nobody.
            nudge(this, "Nikki stopped listening — tap to switch her back on");
            stopForeground(true);
            stopSelf();
        } finally {
            try { if (rec != null) { rec.stop(); rec.release(); } } catch (Throwable ignored) {}
            try { if (stream != null) stream.release(); } catch (Throwable ignored) {}
            try { if (spotter != null) spotter.release(); } catch (Throwable ignored) {}
            running = false;
            if (wakeLock.isHeld()) wakeLock.release();
        }
    }

    /** The conversation after the wake word. The mic is stopped on entry and
     *  restarted by the caller — we open a fresh recorder for each question
     *  so what she just played is not in the buffer. After every answer the
     *  mic stays open a few seconds for a follow-up (no wake word needed):
     *  say more and she continues, stay quiet and she goes back to sleep. */
    private void handleWake() {
        setState("prompt", "చెప్పండి…");
        hud.show("prompt", "");
        // A short chime and the mic is open — the spoken "చెప్పండి" cost a
        // second on every wake. The TLS handshake to the API happens now, in
        // the background, so the question does not pay for it later.
        prewarm();
        play(R.raw.chime);

        boolean first = true;
        for (int turn = 0; turn <= MAX_FOLLOW_UPS && !stopRequested; turn++) {
            setState("recording", first ? "Listening to you…" : "Go on — or stay quiet to finish");
            hud.show("recording", first ? "" : "Go on — or stay quiet to finish");
            byte[] wav = recordQuestion(first ? 6000 : FOLLOW_UP_WAIT_MS);
            if (wav == null) {
                if (first) { hud.show("error", "Didn't catch that"); hud.hide(1200); play(R.raw.chime); }
                else hud.hide(0); // conversation over, quietly
                return;
            }

            setState("thinking", "Nikki is thinking…");
            hud.show("thinking", "");
            try {
                Reply rep = ask(wav);
                String heard = rep.head.optString("transcript", "");
                if (JUST_WAKE.matcher(heard.trim()).matches()) {
                    // She was called again mid-conversation: start over.
                    Log.i(TAG, "wake word repeated: " + heard);
                    rep.close();
                    hud.show("prompt", "");
                    play(R.raw.cheppandi);
                    first = true;
                    continue;
                }
                hud.show("thinking", heard);
                JSONObject action = rep.head.optJSONObject("action");
                if (action != null) {
                    boolean more = runAction(action, rep);
                    if (!more) return; // a call took the screen; nothing to follow up on
                } else {
                    setState("speaking", "Nikki is answering");
                    boolean spoke = playClips(rep);
                    String answer = rep.answer;
                    if (!spoke) {
                        // No speech came back (she didn't catch it, or a hold): show
                        // the text long enough to read and let the person try again.
                        setState("speaking", answer.isEmpty() ? "Didn't catch that" : answer);
                        hud.show("error", answer.isEmpty() ? "Didn't catch that — say “Hey Nikki” again" : answer);
                        hud.hide(3000);
                        play(R.raw.chime);
                        return;
                    }
                    setState("speaking", answer);
                }
            } catch (Exception e) {
                Log.w(TAG, "voice-query failed", e);
                setState("error", "Couldn't reach Nikki: " + e.getMessage());
                hud.show("error", e.getMessage());
                hud.hide(2500);
                play(R.raw.chime);
                return;
            }
            // Her answer is done: a soft tick says "still listening".
            play(R.raw.tick);
            first = false;
        }
        hud.hide(0);
    }

    /** "Call amma" / "wake me at six": confirm in her voice, then do it. For
     *  a call the contact is matched first so a miss is answered honestly
     *  instead of after a promise. */
    private boolean runAction(JSONObject action, Reply rep) {
        String type = action.optString("type", "");
        String say = rep.head.optString("reply", "");
        try {
            if ("call".equals(type)) {
                DeviceActions.Contact who = DeviceActions.findContact(this, action);
                if (who == null) {
                    Log.i(TAG, "action call: no contact for " + action.optString("name"));
                    setState("speaking", "No contact named " + action.optString("name"));
                    hud.show("error", "No contact named “" + action.optString("name") + "”");
                    rep.close();
                    play(R.raw.no_contact);
                    return true; // "who did you mean?" is a natural follow-up
                }
                Log.i(TAG, "action call: " + who.name);
                setState("speaking", "Calling " + who.name);
                hud.show("speaking", "Calling " + who.name + "…");
                playClips(rep);
                if (!DeviceActions.call(this, who)) { play(R.raw.cant_do); hud.hide(1000); return true; }
                hud.hide(1000);
                return false;
            }
            boolean ok;
            if ("alarm".equals(type)) {
                Log.i(TAG, "action alarm: " + action.optInt("hour") + ":" + action.optInt("minute"));
                setState("speaking", say);
                hud.show("speaking", say);
                ok = DeviceActions.alarm(this, action);
            } else if ("timer".equals(type)) {
                Log.i(TAG, "action timer: " + action.optInt("seconds") + "s");
                setState("speaking", say);
                hud.show("speaking", say);
                ok = DeviceActions.timer(this, action);
            } else ok = false;
            if (ok) playClips(rep); else { rep.close(); hud.show("error", "Couldn't do that"); play(R.raw.cant_do); }
            return true;
        } catch (Exception e) {
            Log.w(TAG, "action failed", e);
            hud.show("error", "Couldn't do that");
            play(R.raw.cant_do);
            return true;
        }
    }

    /** Writes the ring buffer (last 12 s heard while waiting for the wake
     *  word) to cache/mic_dump.wav. Debug builds only. */
    private void dumpMic() {
        try {
            int len = ringFull ? ring.length : ringPos;
            int start = ringFull ? ringPos : 0;
            ByteArrayOutputStream pcm = new ByteArrayOutputStream(len * 2);
            for (int i = 0; i < len; i++) { short v = ring[(start + i) % ring.length]; pcm.write(v & 0xff); pcm.write((v >> 8) & 0xff); }
            File f = new File(getCacheDir(), "mic_dump.wav");
            try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(wav(pcm.toByteArray())); }
            Log.i(TAG, "mic dump: " + f + " " + (len / SAMPLE_RATE) + "s");
        } catch (Throwable t) { Log.w(TAG, "mic dump failed", t); }
    }

    /** Plays the answer sentence by sentence as the clips arrive; the
     *  second sentence is still downloading while the first is heard.
     *  Returns false when there was nothing to play. */
    private boolean playClips(Reply rep) {
        boolean any = false;
        int i = 0;
        try {
            for (;;) {
                Object item = rep.clips.poll(30, TimeUnit.SECONDS);
                if (item == null || item == Reply.END) break;
                byte[] audio = (byte[]) item;
                any = true;
                hud.show("speaking", rep.answer);
                File tmp = new File(getCacheDir(), "answer-" + (i++ % 2) + ".mp3");
                try (FileOutputStream fo = new FileOutputStream(tmp)) { fo.write(audio); }
                play(tmp);
            }
        } catch (Exception e) { Log.w(TAG, "playback failed", e); }
        finally { rep.close(); }
        return any;
    }

    /** Energy-gated capture: waits up to waitMs for speech, then stops after
     *  1.2 s of silence or 12 s total. Returns a 16 kHz mono WAV, or null. */
    private byte[] recordQuestion(int waitMs) {
        AudioRecord rec = openMic();
        ByteArrayOutputStream pcm = new ByteArrayOutputStream();
        try {
            rec.startRecording();
            short[] buf = new short[SAMPLE_RATE / 20]; // 50 ms frames
            double noise = 0; int noiseFrames = 0;
            boolean speaking = false;
            int silentMs = 0, totalMs = 0;
            while (!stopRequested && totalMs < 12000) {
                int n = rec.read(buf, 0, buf.length);
                if (n <= 0) continue;
                totalMs += 50;
                double sum = 0;
                for (int i = 0; i < n; i++) sum += (double) buf[i] * buf[i];
                double rms = Math.sqrt(sum / n);
                if (noiseFrames < 6) { noise = noiseFrames == 0 ? rms : Math.min(noise, rms); noiseFrames++; }
                double thr = Math.min(1500, Math.max(350, noise * 2.5));
                hud.level((float) Math.min(1.0, rms / 3000.0));
                for (int i = 0; i < n; i++) { pcm.write(buf[i] & 0xff); pcm.write((buf[i] >> 8) & 0xff); }
                if (rms > thr) { speaking = true; silentMs = 0; }
                else if (speaking) { silentMs += 50; if (silentMs >= 900) break; }
                else if (totalMs >= waitMs) return null; // nobody said anything
            }
            if (!speaking) return null;
        } finally {
            try { rec.stop(); } catch (Throwable ignored) {}
            rec.release();
        }
        return wav(pcm.toByteArray());
    }

    // Guest conversations ride the landing-page demo endpoint, which keeps a
    // short history per session and caps turns; we rotate the session when
    // it runs out or goes stale.
    private String guestSession = null;
    private long guestSessionAt = 0;

    /** One answer from the server. The head line arrives as soon as she has
     *  heard the question; audio clips (one per sentence, mp3) follow on the
     *  queue while playback is already under way; END closes it. */
    static final class Reply {
        static final Object END = new Object();
        final JSONObject head;
        final LinkedBlockingQueue<Object> clips = new LinkedBlockingQueue<>();
        volatile String answer = "";
        volatile boolean drained = false;   // body fully read: the socket can go back to the pool
        private final HttpURLConnection conn;
        Reply(JSONObject head, HttpURLConnection conn) { this.head = head; this.conn = conn; }
        void close() { if (!drained) try { conn.disconnect(); } catch (Throwable ignored) {} }
    }

    /** Opens the TLS connection to the API ahead of the question so the
     *  handshake overlaps the recording; HttpURLConnection keeps it alive. */
    private void prewarm() {
        String base = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE).getString("apiBase", "https://api.heynikki.in");
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/health").openConnection();
                c.setConnectTimeout(5000); c.setReadTimeout(5000);
                c.getResponseCode();
                try (InputStream is = c.getInputStream()) { byte[] b = new byte[512]; while (is.read(b) > 0) {} }
            } catch (Throwable ignored) {}
        }, "nikki-prewarm").start();
    }

    private Reply ask(byte[] wav) throws Exception {
        SharedPreferences p = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        String token = p.getString("token", null);
        String base = p.getString("apiBase", "https://api.heynikki.in");
        JSONObject body = new JSONObject();
        body.put("audio_base64", Base64.encodeToString(wav, Base64.NO_WRAP));
        body.put("mime_type", "audio/wav");
        body.put("stream", true);   // sentence-by-sentence clips, see Reply
        String path;
        if (token != null) {
            path = "/api/app/voice-query";
        } else {
            path = "/api/public/voice-turn";
            if (guestSession == null || System.currentTimeMillis() - guestSessionAt > 25 * 60_000L) {
                guestSession = "app-" + java.util.UUID.randomUUID();
                guestSessionAt = System.currentTimeMillis();
            }
            body.put("session_id", guestSession);
            body.put("persona", "product");
            body.put("device", true);   // unlocks call / alarm / timer actions
        }
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        if (token != null) c.setRequestProperty("Authorization", "Device " + token);
        long t0 = System.currentTimeMillis();
        try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        if (code >= 400) {
            InputStream is = c.getErrorStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            if (is != null) { byte[] b = new byte[8192]; int n; while ((n = is.read(b)) > 0) bo.write(b, 0, n); }
            JSONObject out;
            try { out = new JSONObject(bo.toString("UTF-8")); }
            catch (Exception notJson) { out = new JSONObject(); }
            if (code == 429) throw new Exception("Too many questions right now — try again in a minute");
            if (code == 401 && token != null) {
                // Token revoked/expired: fall back to the product guide until the
                // owner signs in again.
                p.edit().remove("token").apply();
                throw new Exception(out.optString("error", "Signed out"));
            }
            throw new Exception(out.optString("error", "HTTP " + code));
        }
        String ct = String.valueOf(c.getContentType());
        BufferedReader rd = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8), 1 << 16);
        if (!ct.contains("ndjson")) {
            // Plain JSON (an older server): the whole answer in one go.
            StringBuilder sb = new StringBuilder(); char[] cb = new char[8192]; int n;
            while ((n = rd.read(cb)) > 0) sb.append(cb, 0, n);
            JSONObject out = new JSONObject(sb.toString());
            if (out.has("error")) throw new Exception(out.optString("error"));
            Reply rep = new Reply(out, c);
            rep.answer = out.optString("answer", out.optString("reply", ""));
            String b64 = out.optString("audio_base64", "");
            if (!b64.isEmpty()) rep.clips.add(Base64.decode(b64, Base64.DEFAULT));
            rep.clips.add(Reply.END);
            rep.drained = true;
            if (token == null && out.optInt("turns_left", 1) <= 0) guestSession = null;
            return rep;
        }
        String first = rd.readLine();
        if (first == null) throw new Exception("Empty answer");
        JSONObject head = new JSONObject(first);
        if (head.has("error")) throw new Exception(head.optString("error"));
        Log.i(TAG, "heard in " + (System.currentTimeMillis() - t0) + "ms: " + head.optString("transcript"));
        Reply rep = new Reply(head, c);
        rep.answer = head.optString("reply", "");
        if (token == null && head.optInt("turns_left", 1) <= 0) guestSession = null;
        new Thread(() -> {
            try {
                String line;
                while ((line = rd.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    JSONObject j = new JSONObject(line);
                    String b64 = j.optString("audio_base64", "");
                    if (!b64.isEmpty()) {
                        String text = j.optString("text", "");
                        if (!text.isEmpty()) rep.answer = rep.answer.isEmpty() ? text : rep.answer + " " + text;
                        rep.clips.add(Base64.decode(b64, Base64.DEFAULT));
                        Log.i(TAG, "clip " + j.optInt("index") + " at " + (System.currentTimeMillis() - t0) + "ms");
                    }
                    if (j.has("reply")) rep.answer = j.optString("reply", rep.answer);
                    if (j.has("error")) Log.w(TAG, "server: " + j.optString("error"));
                    if (j.optBoolean("done")) { rep.drained = true; break; }
                }
            } catch (Exception e) { Log.w(TAG, "stream ended", e); }
            finally { rep.clips.add(Reply.END); try { rd.close(); } catch (Exception ignored) {} }
        }, "nikki-reply").start();
        return rep;
    }

    // ───────────────────────── helpers ─────────────────────────

    private String idleText() {
        boolean signedIn = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE).getString("token", null) != null;
        return signedIn ? "Listening for “Hey Nikki” / “Nikki”" : "Listening for “Hey Nikki” · sign in to ask about your business";
    }

    private AudioRecord openMic() {
        int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        return new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, SAMPLE_RATE * 2));
    }

    private KeywordSpotterConfig kwsConfig() {
        OnlineTransducerModelConfig t = new OnlineTransducerModelConfig();
        t.setEncoder("kws/encoder.onnx");
        t.setDecoder("kws/decoder.onnx");
        t.setJoiner("kws/joiner.onnx");
        OnlineModelConfig m = new OnlineModelConfig();
        m.setTransducer(t);
        m.setTokens("kws/tokens.txt");
        m.setNumThreads(1);
        m.setProvider("cpu");
        m.setModelType("zipformer2");
        FeatureConfig feat = new FeatureConfig();
        feat.setSampleRate(SAMPLE_RATE);
        feat.setFeatureDim(80);
        KeywordSpotterConfig c = new KeywordSpotterConfig();
        c.setFeatConfig(feat);
        c.setModelConfig(m);
        c.setKeywordsFile("kws/keywords.txt");
        c.setKeywordsScore(2.0f);
        c.setKeywordsThreshold(0.3f);
        c.setMaxActivePaths(4);
        c.setNumTrailingBlanks(1);
        return c;
    }

    private static byte[] wav(byte[] pcm) {
        ByteArrayOutputStream o = new ByteArrayOutputStream(pcm.length + 44);
        int byteRate = SAMPLE_RATE * 2;
        writeStr(o, "RIFF"); writeInt(o, 36 + pcm.length); writeStr(o, "WAVE");
        writeStr(o, "fmt "); writeInt(o, 16); writeShort(o, 1); writeShort(o, 1);
        writeInt(o, SAMPLE_RATE); writeInt(o, byteRate); writeShort(o, 2); writeShort(o, 16);
        writeStr(o, "data"); writeInt(o, pcm.length);
        o.write(pcm, 0, pcm.length);
        return o.toByteArray();
    }
    private static void writeStr(ByteArrayOutputStream o, String s) { byte[] b = s.getBytes(StandardCharsets.US_ASCII); o.write(b, 0, b.length); }
    private static void writeInt(ByteArrayOutputStream o, int v) { o.write(v); o.write(v >> 8); o.write(v >> 16); o.write(v >> 24); }
    private static void writeShort(ByteArrayOutputStream o, int v) { o.write(v); o.write(v >> 8); }

    private void play(int resId) { play(MediaPlayer.create(this, resId, assistantAttrs(), 0)); }
    private void play(File f) {
        MediaPlayer mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(assistantAttrs());
            mp.setDataSource(f.getAbsolutePath());
            mp.prepare();
        } catch (Exception e) { Log.w(TAG, "play failed", e); mp.release(); return; }
        play(mp);
    }
    /** Blocks until playback ends; the mic is stopped meanwhile so we never hear ourselves. */
    private void play(MediaPlayer mp) {
        if (mp == null) return;
        AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
        AudioFocusRequest focus = null;
        if (Build.VERSION.SDK_INT >= 26) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(assistantAttrs()).build();
            am.requestAudioFocus(focus);
        } else {
            am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
        CountDownLatch done = new CountDownLatch(1);
        mp.setOnCompletionListener(p -> done.countDown());
        mp.setOnErrorListener((p, w, e) -> { done.countDown(); return true; });
        mp.start();
        try { done.await(90, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        mp.release();
        if (Build.VERSION.SDK_INT >= 26) am.abandonAudioFocusRequest(focus); else am.abandonAudioFocus(null);
    }

    /** A short tap on wake, like the assistants people already know. */
    private void buzz() {
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(40);
        } catch (Exception ignored) {}
    }

    /** A tappable notification that opens the app; MainActivity.onResume then
     *  starts the listener from the foreground, which Android always allows. */
    static void nudge(Context ctx, String text) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent open = PendingIntent.getActivity(ctx, 2,
            new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIF_ID + 1, b.setContentTitle("Hey Nikki").setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_nikki).setContentIntent(open).setAutoCancel(true).build());
    }
    private static AudioAttributes assistantAttrs() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }

    private void setState(String s, String text) {
        state = s;
        Log.i(TAG, "state=" + s);
        // Once she is up, any earlier "tap to switch back on" nudge is stale.
        if ("listening".equals(s)) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIF_ID + 1);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIF_ID, buildNotification(text));
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Hey Nikki listener", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows while Nikki is listening for “Hey Nikki”.");
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
    }

    private Notification buildNotification(String text) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent open = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        PendingIntent stop = PendingIntent.getService(this, 1,
            new Intent(this, HeyNikkiService.class).setAction(ACTION_STOP), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle("Hey Nikki")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_nikki)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(new Notification.Action.Builder(null, "Stop listening", stop).build())
            .build();
    }
}
