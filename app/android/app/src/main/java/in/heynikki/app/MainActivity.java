package in.heynikki.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    /** The activity currently on screen, if any — NikkiHud draws inside it
     *  rather than as a system overlay when the app itself is open. */
    static volatile MainActivity visible;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HeyNikkiPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** The owner switched “Hey Nikki” on once; every time the app comes to the
     *  front we make sure the listener is actually up (after a reboot, after
     *  the OS killed it, after a swipe-away). Android lets a mic service start
     *  from a visible activity, which is exactly this moment. */
    @Override
    public void onPause() { if (visible == this) visible = null; super.onPause(); }

    @Override
    public void onResume() {
        super.onResume();
        visible = this;
        setUp();
    }

    private static final int REQ_FIRST_RUN = 7001;
    /** The runtime dialog goes up at most once per launch of the app. */
    private boolean askedThisLaunch = false;
    private boolean dialogUp = false;

    /** Everything she needs, asked for on the very first open, one screen
     *  after another: the system dialog (microphone, notifications, contacts,
     *  phone) → the “display over other apps” switch → the battery exemption.
     *  Android grants none of these at install time, so the first open is the
     *  earliest they can be asked for.
     *
     *  Each call does the next step that is still outstanding and stops; the
     *  person coming back from a dialog or a Settings screen resumes the
     *  activity, which calls this again. A refusal does not end the chain —
     *  it used to, so saying no to the microphone also meant never being
     *  offered the other two, and nothing was ever asked a second time. */
    private void setUp() {
        if (dialogUp) return;
        List<String> missing = missingPermissions();
        if (!missing.isEmpty() && !askedThisLaunch) {
            // Asked again on a later launch while something is still missing.
            // After a second refusal Android answers for the user without
            // showing anything, so this cannot turn into nagging.
            askedThisLaunch = true;
            dialogUp = true;
            ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), REQ_FIRST_RUN);
            return;
        }
        if (micGranted()) HeyNikkiService.startIfEnabled(this);
        if (askOverlayOnce()) return;
        askBatteryOnce();
    }

    private List<String> missingPermissions() {
        List<String> want = new ArrayList<>();
        want.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33) want.add(Manifest.permission.POST_NOTIFICATIONS);
        // "Hey Nikki, call amma" — contacts to find her, phone to ring her.
        want.add(Manifest.permission.READ_CONTACTS);
        want.add(Manifest.permission.CALL_PHONE);
        List<String> missing = new ArrayList<>();
        for (String perm : want) if (!DeviceActions.has(this, perm)) missing.add(perm);
        return missing;
    }

    private boolean micGranted() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    /** The glow bar over other apps needs its own switch in Settings.
     *  Returns true when that screen was opened. */
    private boolean askOverlayOnce() {
        if (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this)) return false;
        SharedPreferences p = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        if (p.getBoolean("askedOverlay", false)) return false;
        p.edit().putBoolean("askedOverlay", true).apply();
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName())));
            return true;
        } catch (Exception ignored) { return false; }
    }

    /** Without this the phone puts the listener to sleep after a while. */
    private void askBatteryOnce() {
        if (Build.VERSION.SDK_INT < 23) return;
        SharedPreferences p = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        if (p.getBoolean("askedBattery", false)) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        p.edit().putBoolean("askedBattery", true).apply();
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_FIRST_RUN) return;
        dialogUp = false;
        // When Android answers without showing a dialog the activity never
        // paused, so no resume is coming to carry the chain on.
        if (visible == this) setUp();
    }
}
