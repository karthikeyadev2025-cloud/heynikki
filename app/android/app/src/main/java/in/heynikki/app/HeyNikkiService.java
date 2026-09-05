package in.heynikki.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
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
    private volatile boolean stopRequested = false;
    private PowerManager.WakeLock wakeLock;

    static boolean isRunning() { return running; }
    static String stateName() { return state; }

    static boolean isEnabled(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        return p.getBoolean("enabled", false) && p.getString("token", null) != null;
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
        if (ACTION_STOP.equals(action) || !p.getBoolean("enabled", false) || p.getString("token", null) == null) {
            shutdown();
            return START_NOT_STICKY;
        }
        ensureChannel();
        Notification n = buildNotification("Listening for “Hey Nikki”");
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTIF_ID, n);
        if (worker == null || !worker.isAlive()) {
            stopRequested = false;
            worker = new Thread(this::loop, "heynikki-listener");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopRequested = true;
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    private void shutdown() {
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
            setState("listening", "Listening for “Hey Nikki”");

            short[] buf = new short[SAMPLE_RATE / 10]; // 100 ms
            float[] f = new float[buf.length];
            while (!stopRequested) {
                int n = rec.read(buf, 0, buf.length);
                if (n <= 0) continue;
                for (int i = 0; i < n; i++) f[i] = buf[i] / 32768f;
                stream.acceptWaveform(n == f.length ? f : java.util.Arrays.copyOf(f, n), SAMPLE_RATE);
                while (spotter.isReady(stream)) spotter.decode(stream);
                KeywordSpotterResult r = spotter.getResult(stream);
                if (r.getKeyword() != null && !r.getKeyword().isEmpty()) {
                    Log.i(TAG, "wake word: " + r.getKeyword());
                    spotter.reset(stream);
                    rec.stop();
                    handleWake();
                    rec.startRecording();
                    setState("listening", "Listening for “Hey Nikki”");
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "listener died", t);
            setState("error", "Listener stopped: " + t.getMessage());
        } finally {
            try { if (rec != null) { rec.stop(); rec.release(); } } catch (Throwable ignored) {}
            try { if (stream != null) stream.release(); } catch (Throwable ignored) {}
            try { if (spotter != null) spotter.release(); } catch (Throwable ignored) {}
            running = false;
            if (wakeLock.isHeld()) wakeLock.release();
        }
    }

    /** The exchange after the wake word. The mic is stopped on entry and
     *  restarted by the caller — we open a fresh recorder for the question so
     *  the prompt we just played is not in the buffer. */
    private void handleWake() {
        setState("prompt", "చెప్పండి…");
        play(R.raw.chime);
        play(R.raw.cheppandi);

        setState("recording", "Listening to you…");
        byte[] wav = recordQuestion();
        if (wav == null) { play(R.raw.chime); return; }

        setState("thinking", "Nikki is thinking…");
        try {
            JSONObject out = ask(wav);
            String answer = out.optString("answer", "");
            String b64 = out.optString("audio_base64", "");
            if (!b64.isEmpty()) {
                setState("speaking", answer.isEmpty() ? "Nikki is answering" : answer);
                File tmp = new File(getCacheDir(), "answer.wav");
                try (FileOutputStream fo = new FileOutputStream(tmp)) { fo.write(Base64.decode(b64, Base64.DEFAULT)); }
                play(tmp);
            }
        } catch (Exception e) {
            Log.w(TAG, "voice-query failed", e);
            setState("error", "Couldn't reach Nikki: " + e.getMessage());
            play(R.raw.chime);
        }
    }

    /** Energy-gated capture: waits up to 6 s for speech, then stops after
     *  1.2 s of silence or 12 s total. Returns a 16 kHz mono WAV, or null. */
    private byte[] recordQuestion() {
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
                if (noiseFrames < 6) { noise += rms; noiseFrames++; if (noiseFrames == 6) noise /= 6; }
                double thr = Math.max(350, (noiseFrames < 6 ? 350 : noise * 2.5));
                for (int i = 0; i < n; i++) { pcm.write(buf[i] & 0xff); pcm.write((buf[i] >> 8) & 0xff); }
                if (rms > thr) { speaking = true; silentMs = 0; }
                else if (speaking) { silentMs += 50; if (silentMs >= 1200) break; }
                else if (totalMs >= 6000) return null; // nobody said anything
            }
            if (!speaking) return null;
        } finally {
            try { rec.stop(); } catch (Throwable ignored) {}
            rec.release();
        }
        return wav(pcm.toByteArray());
    }

    private JSONObject ask(byte[] wav) throws Exception {
        SharedPreferences p = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        String token = p.getString("token", "");
        String base = p.getString("apiBase", "https://api.heynikki.in");
        JSONObject body = new JSONObject();
        body.put("audio_base64", Base64.encodeToString(wav, Base64.NO_WRAP));
        body.put("mime_type", "audio/wav");
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/app/voice-query").openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Authorization", "Device " + token);
        try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] b = new byte[8192]; int n;
        while ((n = is.read(b)) > 0) bo.write(b, 0, n);
        JSONObject out = new JSONObject(bo.toString("UTF-8"));
        if (code == 401) {
            // Token revoked/expired: stop answering until the owner signs in again.
            p.edit().putBoolean("enabled", false).apply();
            stopRequested = true;
            throw new Exception(out.optString("error", "Signed out"));
        }
        if (code >= 400) throw new Exception(out.optString("error", "HTTP " + code));
        return out;
    }

    // ───────────────────────── helpers ─────────────────────────

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
        am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        CountDownLatch done = new CountDownLatch(1);
        mp.setOnCompletionListener(p -> done.countDown());
        mp.setOnErrorListener((p, w, e) -> { done.countDown(); return true; });
        mp.start();
        try { done.await(90, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        mp.release();
        am.abandonAudioFocus(null);
    }
    private static AudioAttributes assistantAttrs() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }

    private void setState(String s, String text) {
        state = s;
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
