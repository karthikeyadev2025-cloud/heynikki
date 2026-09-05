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
    public void onResume() {
        super.onResume();
        if (micGranted()) { HeyNikkiService.startIfEnabled(this); askBatteryOnce(); }
        else askPermissionsOnce();
    }

    /** One system dialog per resume, so they arrive one after another rather
     *  than stacked: mic → overlay (on grant) → battery (next resume). */
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

    private static final int REQ_FIRST_RUN = 7001;

    private boolean micGranted() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    /** First open: ask for the mic (and notifications on 13+) straight away so
     *  “Hey Nikki” works before anyone signs in. Asked once; the dashboard
     *  pill can re-ask if it was refused. */
    private void askPermissionsOnce() {
        SharedPreferences p = getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        if (p.getBoolean("askedFirstRun", false)) return;
        p.edit().putBoolean("askedFirstRun", true).apply();
        List<String> want = new ArrayList<>();
        want.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33) want.add(Manifest.permission.POST_NOTIFICATIONS);
        ActivityCompat.requestPermissions(this, want.toArray(new String[0]), REQ_FIRST_RUN);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_FIRST_RUN || !micGranted()) return;
        HeyNikkiService.startIfEnabled(this);
        // The glow bar over other apps needs its own switch in Settings.
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {}
        }
    }
}
