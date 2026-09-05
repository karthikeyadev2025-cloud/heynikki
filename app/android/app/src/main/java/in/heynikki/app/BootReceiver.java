package in.heynikki.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * After a reboot Android 14+ refuses to start a microphone service from the
 * background, so we try, and if refused leave a one-tap notification — the
 * tap opens the app, whose onResume starts the listener legitimately.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!HeyNikkiService.isEnabled(ctx)) return;
        try {
            HeyNikkiService.startIfEnabled(ctx);
        } catch (Exception refused) {
            nudge(ctx);
        }
        // Even when the start call itself did not throw, Android 14+ may kill
        // it silently a moment later; the nudge is harmless if she is up.
        if (Build.VERSION.SDK_INT >= 34) nudge(ctx);
    }

    private void nudge(Context ctx) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(ctx, 2,
            new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, HeyNikkiService.CHANNEL) : new Notification.Builder(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(HeyNikkiService.NOTIF_ID + 1, b.setContentTitle("Hey Nikki")
            .setContentText("Phone restarted — tap to switch Nikki back on")
            .setSmallIcon(R.drawable.ic_stat_nikki)
            .setContentIntent(open).setAutoCancel(true).build());
    }
}
