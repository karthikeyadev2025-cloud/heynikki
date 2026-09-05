package in.heynikki.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

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
        HeyNikkiService.startIfEnabled(this);
    }
}
