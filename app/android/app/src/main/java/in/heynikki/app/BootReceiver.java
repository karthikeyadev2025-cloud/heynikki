package in.heynikki.app;

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
            HeyNikkiService.nudge(ctx, "Phone restarted — tap to switch Nikki back on");
        }
        // Even when the start call itself did not throw, Android 14+ may kill
        // it silently a moment later; the nudge is harmless if she is up.
        if (Build.VERSION.SDK_INT >= 34) HeyNikkiService.nudge(ctx, "Phone restarted — tap to switch Nikki back on");
    }

}
