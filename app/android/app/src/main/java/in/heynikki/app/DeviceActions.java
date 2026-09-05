package in.heynikki.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What the phone itself can do when Nikki is asked: ring a contact from the
 * owner's own SIM, set an alarm, start a timer. The server only decides
 * *which* (see detectDeviceAction in api-server); the matching and the
 * intents happen here so no contact ever leaves the phone.
 */
final class DeviceActions {
    private static final String TAG = HeyNikkiService.TAG;

    static final class Contact { final String name, number; Contact(String n, String p) { name = n; number = p; } }

    private DeviceActions() {}

    static boolean has(Context ctx, String perm) {
        return ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED;
    }

    /** Best contact for the spoken name. Variants come from the server in
     *  Latin script (amma → mom, mummy…) because contacts are rarely saved
     *  in Telugu script. Null when nothing is close enough. */
    static Contact findContact(Context ctx, JSONObject action) {
        if (!has(ctx, Manifest.permission.READ_CONTACTS)) return null;
        List<String> wants = new ArrayList<>();
        String spoken = norm(action.optString("name", ""));
        if (!spoken.isEmpty()) wants.add(spoken);
        JSONArray va = action.optJSONArray("name_variants");
        if (va != null) for (int i = 0; i < va.length(); i++) { String v = norm(va.optString(i, "")); if (!v.isEmpty()) wants.add(v); }
        if (wants.isEmpty()) return null;

        Contact best = null; int bestScore = 0;
        String[] cols = { ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                          ContactsContract.CommonDataKinds.Phone.NUMBER,
                          ContactsContract.CommonDataKinds.Phone.IS_PRIMARY };
        try (Cursor c = ctx.getContentResolver().query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String name = c.getString(0), number = c.getString(1);
                if (name == null || number == null) continue;
                String n = norm(name);
                int score = 0;
                for (String w : wants) {
                    int s = 0;
                    if (n.equals(w)) s = 100;
                    else if (n.startsWith(w + " ") || n.endsWith(" " + w) || n.contains(" " + w + " ")) s = 90;
                    else if (n.startsWith(w)) s = 75;
                    else if (n.contains(" " + w)) s = 65;
                    else if (w.length() >= 4 && n.contains(w)) s = 50;
                    if (s > score) score = s;
                }
                if (score > 0 && c.getInt(2) != 0) score += 1;   // primary number wins a tie
                if (score > bestScore) { bestScore = score; best = new Contact(name, number); }
            }
        } catch (Exception e) { Log.w(TAG, "contacts query failed", e); }
        return bestScore >= 50 ? best : null;
    }

    private static String norm(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N} ]", " ").replaceAll("\\s+", " ").trim();
    }

    /** Ring them. Direct dial when we hold CALL_PHONE, else the dialer with
     *  the number filled in — either way from the owner's SIM. */
    static boolean call(Context ctx, Contact who) {
        Uri tel = Uri.parse("tel:" + who.number);
        Intent direct = new Intent(Intent.ACTION_CALL, tel);
        Intent dialer = new Intent(Intent.ACTION_DIAL, tel);
        Intent i = has(ctx, Manifest.permission.CALL_PHONE) ? direct : dialer;
        return launch(ctx, i, "Tap to call " + who.name);
    }

    static boolean alarm(Context ctx, JSONObject a) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, a.optInt("hour", 7))
            .putExtra(AlarmClock.EXTRA_MINUTES, a.optInt("minute", 0))
            .putExtra(AlarmClock.EXTRA_MESSAGE, a.optString("label", "Hey Nikki"))
            .putExtra(AlarmClock.EXTRA_VIBRATE, true)
            // Open the clock so the owner sees it land — that is the confirmation.
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        return launch(ctx, i, "Tap to set the alarm");
    }

    static boolean timer(Context ctx, JSONObject a) {
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, a.optInt("seconds", 300))
            .putExtra(AlarmClock.EXTRA_MESSAGE, a.optString("label", "Hey Nikki"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        return launch(ctx, i, "Tap to start the timer");
    }

    /** Start the activity from the background when Android lets us (the
     *  overlay permission grants that); otherwise leave a one-tap notification
     *  that carries the very same intent. */
    private static boolean launch(Context ctx, Intent i, String fallbackText) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (i.resolveActivity(ctx.getPackageManager()) == null) { Log.w(TAG, "no app handles " + i.getAction()); return false; }
        boolean mayStart = MainActivity.visible != null || Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(ctx);
        if (mayStart) {
            try { ctx.startActivity(i); return true; }
            catch (Exception e) { Log.w(TAG, "startActivity failed", e); }
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(ctx, 3, i, flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, HeyNikkiService.CHANNEL) : new Notification.Builder(ctx);
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(HeyNikkiService.NOTIF_ID + 2,
            b.setContentTitle("Hey Nikki").setContentText(fallbackText).setSmallIcon(R.drawable.ic_stat_nikki)
             .setContentIntent(pi).setAutoCancel(true).setPriority(Notification.PRIORITY_HIGH).build());
        return true;
    }
}
