package in.heynikki.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.LinearInterpolator;

/**
 * The visible half of “Hey Nikki”: a glowing bar pinned to the bottom of
 * whatever is on screen while she listens, thinks and answers — the same
 * idea as the assistant glow on Pixel/iPhone. It is a system overlay
 * (needs “display over other apps”); without that permission it simply
 * never shows and the voice loop is unaffected.
 *
 * All calls are safe from any thread; the view itself lives on main.
 */
public class NikkiHud {
    private static final int C_TEAL = 0xFF10B888, C_AMBER = 0xFFBB853C, C_NAVY = 0xF20B0F1A;
    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable hideLater = this::hideNow;
    private WindowManager wm;
    private BarView view;

    NikkiHud(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    static boolean allowed(Context ctx) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx);
    }

    /** Show (or update) the bar. mode: prompt | recording | thinking | speaking | error */
    void show(String mode, String text) {
        main.post(() -> {
            main.removeCallbacks(hideLater);
            if (!allowed(ctx)) return;
            if (view == null) attach();
            if (view != null) view.set(mode, text);
        });
    }

    /** Mic level 0..1 while recording — drives the bars. */
    void level(float v) { main.post(() -> { if (view != null) view.level = v; }); }

    /** Hide after a short beat so the last state (the answer) is readable. */
    void hide(long afterMs) { main.postDelayed(hideLater, afterMs); }

    private void hideNow() {
        if (view != null && wm != null) { try { wm.removeView(view); } catch (Exception ignored) {} }
        if (view != null) view.stop();
        view = null;
    }

    private void attach() {
        wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        int type = Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        float d = ctx.getResources().getDisplayMetrics().density;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, (int) (150 * d), type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM;
        view = new BarView(ctx);
        try { wm.addView(view, lp); } catch (Exception e) { view = null; }
    }

    /** Five bars on a soft navy sheet with the brand gradient, a caption above. */
    static class BarView extends View {
        String mode = "prompt", text = "";
        float level = 0f, phase = 0f;
        private final Paint bar = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint sheet = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint txt = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint sub = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final ValueAnimator anim = ValueAnimator.ofFloat(0f, (float) (Math.PI * 2));
        private final float d;

        BarView(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
            sheet.setColor(C_NAVY);
            txt.setColor(Color.WHITE); txt.setTextSize(15 * d); txt.setTextAlign(Paint.Align.CENTER);
            txt.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            sub.setColor(0xFF9AA4B8); sub.setTextSize(12 * d); sub.setTextAlign(Paint.Align.CENTER);
            anim.setDuration(1400); anim.setRepeatCount(ValueAnimator.INFINITE);
            anim.setInterpolator(new LinearInterpolator());
            anim.addUpdateListener(a -> { phase = (float) a.getAnimatedValue(); invalidate(); });
            anim.start();
        }

        void set(String m, String t) { mode = m; text = t == null ? "" : t; invalidate(); }
        void stop() { anim.cancel(); }

        @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
            bar.setShader(new LinearGradient(0, 0, w, 0, C_TEAL, C_AMBER, Shader.TileMode.CLAMP));
            glow.setShader(new LinearGradient(0, h - 90 * d, 0, h, 0x0010B888, 0x5510B888, Shader.TileMode.CLAMP));
        }

        @Override protected void onDraw(Canvas c) {
            int w = getWidth(), h = getHeight();
            // sheet with rounded top, glow at the very bottom edge
            RectF r = new RectF(0, 34 * d, w, h + 40 * d);
            c.drawRoundRect(r, 28 * d, 28 * d, sheet);
            c.drawRect(0, h - 90 * d, w, h, glow);

            // caption(s)
            String head = "speaking".equals(mode) ? "Nikki" :
                          "thinking".equals(mode) ? "Nikki is thinking…" :
                          "recording".equals(mode) ? "Listening…" :
                          "error".equals(mode) ? "Couldn't reach Nikki" : "చెప్పండి";
            c.drawText(head, w / 2f, 66 * d, txt);
            if (!text.isEmpty() && !text.equals(head)) {
                String t = text.length() > 70 ? text.substring(0, 68) + "…" : text;
                c.drawText(t, w / 2f, 86 * d, sub);
            }

            // five bars, centred, breathing by mode and reacting to the mic
            float bw = 8 * d, gap = 8 * d, base = h - 26 * d, maxH = 44 * d;
            float x0 = w / 2f - (5 * bw + 4 * gap) / 2f;
            for (int i = 0; i < 5; i++) {
                float k;
                switch (mode) {
                    case "recording": k = 0.2f + Math.min(1f, level * 2.5f) * (0.5f + 0.5f * (float) Math.abs(Math.sin(phase + i * 0.9f))); break;
                    case "thinking":  k = 0.25f + 0.15f * (float) Math.sin(phase * 2 + i * 1.2f); break;
                    case "speaking":  k = 0.35f + 0.5f * (float) Math.abs(Math.sin(phase * 3 + i * 0.7f)); break;
                    case "error":     k = 0.15f; break;
                    default:          k = 0.3f + 0.35f * (float) Math.abs(Math.sin(phase + i * 0.6f)); // prompt
                }
                float bh = Math.max(6 * d, maxH * k);
                float x = x0 + i * (bw + gap);
                c.drawRoundRect(new RectF(x, base - bh, x + bw, base), bw / 2, bw / 2, bar);
            }
        }
    }
}
