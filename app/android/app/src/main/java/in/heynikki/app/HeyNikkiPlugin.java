package in.heynikki.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * JS ↔ native bridge for the always-on “Hey Nikki” listener.
 * The web app (web/lib/native.ts) calls start({token, apiBase}) once the
 * owner has a device token; everything after that lives in HeyNikkiService.
 */
@CapacitorPlugin(
    name = "HeyNikki",
    permissions = {
        @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notify", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class HeyNikkiPlugin extends Plugin {
    static final String PREFS = "heynikki";

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("running", HeyNikkiService.isRunning());
        r.put("permission", micGranted() ? "granted" : "denied");
        r.put("state", HeyNikkiService.stateName());
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (micGranted()) { finishPermission(call); return; }
        // Notifications are only a runtime permission from Android 13; asking
        // for both in one go keeps it to a single dialog sequence.
        if (Build.VERSION.SDK_INT >= 33) requestPermissionForAliases(new String[]{"mic", "notify"}, call, "permDone");
        else requestPermissionForAlias("mic", call, "permDone");
    }

    @PermissionCallback
    private void permDone(PluginCall call) { finishPermission(call); }

    private void finishPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("permission", micGranted() ? "granted" : "denied");
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String token = call.getString("token");
        String apiBase = call.getString("apiBase", "https://api.heynikki.in");
        if (token == null || token.isEmpty()) { call.reject("token required"); return; }
        if (!micGranted()) { call.reject("Microphone permission not granted"); return; }
        Context ctx = getContext();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putString("token", token).putString("apiBase", apiBase).putBoolean("enabled", true).apply();
        Intent i = new Intent(ctx, HeyNikkiService.class).setAction(HeyNikkiService.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        askToSkipBatteryOptimisation(ctx);
        JSObject r = new JSObject();
        r.put("running", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
        ctx.startService(new Intent(ctx, HeyNikkiService.class).setAction(HeyNikkiService.ACTION_STOP));
        JSObject r = new JSObject();
        r.put("running", false);
        call.resolve(r);
    }

    /** Sign-out: drop the token so a restarted service cannot keep answering. */
    @PluginMethod
    public void forget(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        ctx.startService(new Intent(ctx, HeyNikkiService.class).setAction(HeyNikkiService.ACTION_STOP));
        call.resolve();
    }

    /** Doze and vendor battery managers (vivo, Xiaomi…) kill background
     *  services after a few minutes unless the app is exempted. One system
     *  dialog; the user sees it once. */
    private void askToSkipBatteryOptimisation(Context ctx) {
        if (Build.VERSION.SDK_INT < 23) return;
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) return;
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + ctx.getPackageName()));
            getActivity().startActivity(i);
        } catch (Exception ignored) {}
    }

    private boolean micGranted() {
        return getPermissionState("mic") == PermissionState.GRANTED;
    }
}
