package in.heynikki.app;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/**
 * What the app shows before the dashboard is on screen.
 *
 * Every launch: her mark — a glowing orb with five voice bars — on the brand
 * navy while the dashboard loads behind it, so opening the app is never a
 * white page. It lifts when the page is ready.
 *
 * The first launch only: she introduces herself. Four short screens, each
 * spoken in her own voice with the things to say shown as chips, in English
 * or Telugu. It comes BEFORE the permission dialogs on purpose: a person who
 * has just been told why she needs the microphone is far likelier to allow
 * it than one who is asked cold.
 *
 * Everything is drawn here; there is no layout XML and no image to load, so
 * it is on screen in the first frame.
 */
class NikkiWelcome {
    private static final int C_TEAL = 0xFF10B888, C_AMBER = 0xFFBB853C, C_NAVY = 0xFF0B0F1A;
    private static final long MIN_SPLASH_MS = 1700, MAX_SPLASH_MS = 8000;

    /** True while she is speaking her introduction — the listener must not
     *  wake to her own voice saying “Hey Nikki”. */
    static volatile boolean speaking = false;

    interface Done { void run(); }
    interface Ready { boolean pageLoaded(); }

    private final Activity act;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SharedPreferences prefs;
    private final boolean firstRun;
    private final Done done;
    private final Ready ready;
    private final long shownAt = System.currentTimeMillis();
    private final float d;

    private FrameLayout root;
    private OrbView orb;
    private TextView title, body, next, skip, lang;
    private LinearLayout chips, dots, buttons;
    private MediaPlayer voice;
    private boolean active = true;
    private int slide = -1;   // -1 while it is still the splash
    private int turn = 0;     // bumps on every slide change; stale callbacks check it
    private String language;

    // title, body, chips…
    private static final String[][] EN = {
        { "Hi, I’m Nikki", "I answer your business phone day and night, book appointments and note every lead.",
          "Answers every call", "Books appointments", "Notes every lead" },
        { "Just call my name", "Say it any time — even with the screen off.",
          "“Hey Nikki”", "“Hello Nikki”", "“Nikki”" },
        { "Ask me about your business", "I will tell you straight away.",
          "“How many calls today?”", "“Who is coming tomorrow?”", "“Any hot leads?”" },
        { "Teach me, and I’ll do things", "Tell me a fact and I repeat it to your callers.",
          "“We are closed next Monday”", "“Call amma”", "“Wake me at 6”" },
    };
    private static final String[][] TE = {
        { "నమస్కారం, నేను నిక్కీ", "మీ బిజినెస్ ఫోన్‌కి రాత్రి పగలు నేనే సమాధానం చెప్తాను.",
          "ప్రతి కాల్‌కి సమాధానం", "అపాయింట్‌మెంట్ బుకింగ్", "ప్రతి లీడ్ నోట్" },
        { "నా పేరు పిలవండి చాలు", "ఎప్పుడైనా — స్క్రీన్ ఆఫ్‌లో ఉన్నా వింటాను.",
          "“హే నిక్కీ”", "“హలో నిక్కీ”", "“నిక్కీ”" },
        { "మీ బిజినెస్ గురించి అడగండి", "వెంటనే చెప్తాను.",
          "“ఈ రోజు ఎన్ని కాల్స్?”", "“రేపు ఎవరు వస్తున్నారు?”", "“ముఖ్యమైన లీడ్స్ ఏవి?”" },
        { "నాకు నేర్పండి, పనులు చేస్తాను", "మీరు చెప్పిన విషయం కాలర్స్‌కి చెప్తాను.",
          "“సోమవారం సెలవు”", "“అమ్మకి కాల్ చెయ్”", "“ఆరింటికి లేపు”" },
    };
    private static final int[] VOICE_EN = { R.raw.intro_en_1, R.raw.intro_en_2, R.raw.intro_en_3, R.raw.intro_en_4 };
    private static final int[] VOICE_TE = { R.raw.intro_te_1, R.raw.intro_te_2, R.raw.intro_te_3, R.raw.intro_te_4 };

    /** The language she speaks in on this phone: chosen in the introduction,
     *  otherwise the phone's own. */
    static String language(Context ctx) {
        String saved = ctx.getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE).getString("lang", null);
        if (saved != null) return saved;
        return "te".equals(Locale.getDefault().getLanguage()) ? "te" : "en";
    }

    NikkiWelcome(Activity act, Ready ready, Done done) {
        this.act = act;
        this.ready = ready;
        this.done = done;
        this.d = act.getResources().getDisplayMetrics().density;
        this.prefs = act.getSharedPreferences(HeyNikkiPlugin.PREFS, Context.MODE_PRIVATE);
        this.firstRun = !prefs.getBoolean("introDone", false);
        this.language = language(act);
        build();
        main.postDelayed(this::poll, 200);
    }

    boolean active() { return active; }

    /** The app left the screen: she stops talking mid-sentence rather than
     *  carrying on over whatever the person switched to. */
    void silence() { stopVoice(); }

    // ───────────────────────── building ─────────────────────────

    private int dp(float v) { return Math.round(v * d); }

    private TextView text(float sp, int color, boolean bold) {
        TextView t = new TextView(act);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        return t;
    }

    private GradientDrawable pill(int fill, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(999));
        if (stroke != 0) g.setStroke(dp(1), stroke);
        return g;
    }

    private void build() {
        root = new FrameLayout(act);
        root.setBackgroundColor(C_NAVY);
        root.setClickable(true);   // nothing behind it is touchable while it is up

        LinearLayout col = new LinearLayout(act);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(28), dp(56), dp(28), dp(36));
        root.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        col.addView(new View(act), new LinearLayout.LayoutParams(0, 0, 1f));

        orb = new OrbView(act);
        col.addView(orb, new LinearLayout.LayoutParams(dp(220), dp(220)));

        title = text(28, Color.WHITE, true);
        title.setText("Hey Nikki");
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tp.topMargin = dp(18);
        col.addView(title, tp);

        body = text(16, 0xFF9AA4B8, false);
        body.setText("Your AI receptionist");
        body.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(8);
        col.addView(body, bp);

        chips = new LinearLayout(act);
        chips.setOrientation(LinearLayout.VERTICAL);
        chips.setGravity(Gravity.CENTER_HORIZONTAL);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cp.topMargin = dp(22);
        col.addView(chips, cp);

        col.addView(new View(act), new LinearLayout.LayoutParams(0, 0, 1.2f));

        dots = new LinearLayout(act);
        dots.setGravity(Gravity.CENTER);
        dots.setVisibility(View.INVISIBLE);
        col.addView(dots, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)));

        buttons = new LinearLayout(act);
        buttons.setGravity(Gravity.CENTER_VERTICAL);
        buttons.setVisibility(View.INVISIBLE);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        rp.topMargin = dp(14);
        col.addView(buttons, rp);

        skip = text(15, 0xFF9AA4B8, false);
        skip.setPadding(dp(8), 0, dp(20), 0);
        skip.setOnClickListener(v -> finish());
        buttons.addView(skip, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buttons.addView(new View(act), new LinearLayout.LayoutParams(0, 0, 1f));
        next = text(16, C_NAVY, true);
        next.setPadding(dp(30), 0, dp(30), 0);
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{ C_TEAL, 0xFF5CC79A });
        g.setCornerRadius(dp(999));
        next.setBackground(g);
        next.setOnClickListener(v -> { if (slide >= EN.length - 1) finish(); else show(slide + 1); });
        buttons.addView(next, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // English ⇄ తెలుగు, top right. Shown with the introduction only.
        lang = text(14, Color.WHITE, false);
        lang.setPadding(dp(14), dp(7), dp(14), dp(7));
        lang.setBackground(pill(0x22FFFFFF, 0x44FFFFFF));
        lang.setVisibility(View.INVISIBLE);
        lang.setOnClickListener(v -> {
            language = "te".equals(language) ? "en" : "te";
            prefs.edit().putString("lang", language).apply();
            show(slide);
        });
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END);
        lp.topMargin = dp(44); lp.rightMargin = dp(20);
        root.addView(lang, lp);

        ViewGroup host = act.findViewById(android.R.id.content);
        host.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Entrance: the orb swells in, the name rises under it.
        orb.setScaleX(0.6f); orb.setScaleY(0.6f); orb.setAlpha(0f);
        orb.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(700).setInterpolator(new OvershootInterpolator(1.4f)).start();
        rise(title, 250); rise(body, 420);
    }

    private void rise(View v, long delay) {
        v.setAlpha(0f); v.setTranslationY(dp(18));
        v.animate().alpha(1f).translationY(0).setStartDelay(delay).setDuration(450).setInterpolator(new DecelerateInterpolator()).start();
    }

    // ───────────────────────── splash ─────────────────────────

    /** The splash stays for a beat so it reads as intended rather than as a
     *  flicker, and never longer than the page takes — with a ceiling, so a
     *  dead network shows the page's own error instead of an eternal orb. */
    private void poll() {
        if (!active || slide >= 0) return;
        long up = System.currentTimeMillis() - shownAt;
        boolean loaded;
        try { loaded = ready.pageLoaded(); } catch (Throwable t) { loaded = true; }
        if (firstRun && up >= MIN_SPLASH_MS) { show(0); return; }
        if (!firstRun && ((loaded && up >= MIN_SPLASH_MS) || up >= MAX_SPLASH_MS)) { finish(); return; }
        main.postDelayed(this::poll, 120);
    }

    // ───────────────────────── introduction ─────────────────────────

    private void show(int i) {
        if (!active) return;
        slide = i;
        final int mine = ++turn;
        stopVoice();
        boolean te = "te".equals(language);
        String[] s = (te ? TE : EN)[i];
        boolean last = i == EN.length - 1;

        // Four lines of text and three chips need the room on a short phone.
        if (act.getResources().getDisplayMetrics().heightPixels / d < 740) {
            ViewGroup.LayoutParams op = orb.getLayoutParams();
            if (op.width != dp(150)) { op.width = dp(150); op.height = dp(150); orb.setLayoutParams(op); }
        }

        lang.setText(te ? "English" : "తెలుగు");
        lang.setVisibility(View.VISIBLE);
        skip.setText(te ? "వదిలేయండి" : "Skip");
        skip.setVisibility(last ? View.INVISIBLE : View.VISIBLE);
        next.setText(last ? (te ? "మొదలుపెడదాం" : "Get started") : (te ? "తర్వాత" : "Next"));
        dots.setVisibility(View.VISIBLE);
        buttons.setVisibility(View.VISIBLE);

        dots.removeAllViews();
        for (int k = 0; k < EN.length; k++) {
            View dot = new View(act);
            dot.setBackground(pill(k == i ? C_TEAL : 0x33FFFFFF, 0));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(k == i ? 22 : 8), dp(8));
            p.leftMargin = dp(4); p.rightMargin = dp(4);
            dots.addView(dot, p);
        }

        title.animate().cancel(); body.animate().cancel();
        title.setText(s[0]); body.setText(s[1]);
        rise(title, 0); rise(body, 90);

        chips.removeAllViews();
        for (int k = 2; k < s.length; k++) {
            TextView c = text(15, Color.WHITE, false);
            c.setText(s[k]);
            c.setPadding(dp(18), dp(10), dp(18), dp(10));
            c.setBackground(pill(0x1AFFFFFF, 0x3310B888));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.topMargin = dp(10);
            chips.addView(c, p);
            // One after another, roughly as she gets to each.
            rise(c, 500 + (k - 2) * 650L);
        }

        try {
            voice = MediaPlayer.create(act, (te ? VOICE_TE : VOICE_EN)[i],
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(), 0);
            if (voice != null) {
                voice.setOnCompletionListener(p -> {
                    if (mine != turn) return;
                    stopVoice();
                    // She moves on by herself; the last screen waits for a tap,
                    // because what follows it is the permission dialogs.
                    if (!last) main.postDelayed(() -> { if (mine == turn && active) show(slide + 1); }, 900);
                });
                voice.setOnErrorListener((p, w, e) -> { if (mine == turn) stopVoice(); return true; });
                speaking = true;
                orb.talking = true;
                voice.start();
            }
        } catch (Throwable t) {
            // Silent is fine: every word she would have said is on screen.
            Log.w("HeyNikki", "intro voice failed", t);
            stopVoice();
        }
    }

    private void stopVoice() {
        speaking = false;
        if (orb != null) orb.talking = false;
        MediaPlayer v = voice; voice = null;
        if (v != null) { try { v.stop(); } catch (Throwable ignored) {} try { v.release(); } catch (Throwable ignored) {} }
    }

    private void finish() {
        if (!active) return;
        active = false;
        turn++;
        stopVoice();
        main.removeCallbacksAndMessages(null);
        if (firstRun) prefs.edit().putBoolean("introDone", true).putString("lang", language).apply();
        root.animate().alpha(0f).setDuration(350).withEndAction(() -> {
            try { ((ViewGroup) root.getParent()).removeView(root); } catch (Throwable ignored) {}
            orb.stop();
            done.run();
        }).start();
    }

    // ───────────────────────── her mark ─────────────────────────

    /** Rings breathing out of a glowing core, five voice bars in the middle.
     *  The bars idle gently and dance while she is speaking. */
    static class OrbView extends View {
        volatile boolean talking = false;
        private float phase = 0f, energy = 0f;
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint core = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint halo = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint bar = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();
        private final ValueAnimator anim = ValueAnimator.ofFloat(0f, 1f);
        private final float d;

        OrbView(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(2 * d);
            bar.setColor(Color.WHITE);
            anim.setDuration(2600); anim.setRepeatCount(ValueAnimator.INFINITE);
            anim.setInterpolator(new LinearInterpolator());
            anim.addUpdateListener(a -> {
                phase = (float) a.getAnimatedValue();
                energy += ((talking ? 1f : 0f) - energy) * 0.08f;   // ease between idle and speaking
                invalidate();
            });
            anim.start();
        }

        void stop() { anim.cancel(); }

        @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
            float cx = w / 2f, cy = h / 2f, rad = Math.min(w, h) * 0.26f;
            core.setShader(new LinearGradient(cx - rad, cy - rad, cx + rad, cy + rad, C_TEAL, C_AMBER, Shader.TileMode.CLAMP));
            halo.setShader(new RadialGradient(cx, cy, Math.min(w, h) / 2f,
                new int[]{ 0x5510B888, 0x1410B888, 0x0010B888 }, new float[]{ 0.3f, 0.7f, 1f }, Shader.TileMode.CLAMP));
        }

        @Override protected void onDraw(Canvas c) {
            int w = getWidth(), h = getHeight();
            float cx = w / 2f, cy = h / 2f, max = Math.min(w, h) / 2f, rad = max * 0.52f;
            double t = phase * Math.PI * 2;

            c.drawCircle(cx, cy, max, halo);
            // three rings, each a third of the cycle behind the last
            for (int i = 0; i < 3; i++) {
                float p = (phase + i / 3f) % 1f;
                ring.setColor(i == 1 ? C_AMBER : C_TEAL);
                ring.setAlpha((int) (150 * (1f - p)));
                c.drawCircle(cx, cy, rad + (max - rad - 2 * d) * p, ring);
            }
            float breathe = 1f + 0.035f * (float) Math.sin(t) + 0.03f * energy * (float) Math.sin(t * 5);
            c.drawCircle(cx, cy, rad * breathe, core);

            float bw = 7 * d, gap = 7 * d, maxH = rad * 1.05f;
            float x0 = cx - (5 * bw + 4 * gap) / 2f;
            float[] rest = { 0.30f, 0.52f, 0.78f, 0.52f, 0.30f };
            for (int i = 0; i < 5; i++) {
                float idle = rest[i] * (0.86f + 0.14f * (float) Math.sin(t * 2 + i * 0.8f));
                float live = 0.25f + 0.75f * (float) Math.abs(Math.sin(t * 6 + i * 1.3f) * Math.cos(t * 2.5 + i));
                float k = idle + (live - idle) * energy;
                float bh = Math.max(bw, maxH * k);
                float x = x0 + i * (bw + gap);
                r.set(x, cy - bh / 2, x + bw, cy + bh / 2);
                c.drawRoundRect(r, bw / 2, bw / 2, bar);
            }
        }
    }
}
