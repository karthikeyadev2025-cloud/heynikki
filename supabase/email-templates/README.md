# Supabase Email Templates

Branded HTML for the auth emails Supabase sends. To install:

1. Open **Supabase Dashboard → Authentication → Email Templates**
2. Paste each file's content into the matching template:

| Supabase template     | File in this folder       |
|-----------------------|---------------------------|
| Confirm signup        | `confirm-signup.html`     |
| Magic Link            | `magic-link.html`         |
| Reset Password        | `reset-password.html`     |
| Change Email Address  | (use `magic-link.html` style — adapt subject + heading) |
| Invite User           | (use `magic-link.html` style — adapt) |

3. Make sure these settings are also configured:
   - **Site URL:** `https://heynikki.in`
   - **Redirect URLs:** add `https://heynikki.in/reset-password`,
     `https://dashboard.heynikki.in/dashboard`, and any others you use.
   - **SMTP settings (Auth → SMTP Settings):** point at Resend or
     a real SMTP provider. The default Supabase SMTP is rate-limited
     and the From address is `noreply@mail.app.supabase.io`, which
     looks unprofessional and triggers spam filters more often.

## Template variables

Supabase exposes Liquid-like vars inside templates:

- `{{ .ConfirmationURL }}` — main action link (most important)
- `{{ .Email }}`           — recipient's email
- `{{ .Token }}`           — raw OTP token (rarely needed if you have the URL)
- `{{ .TokenHash }}`       — hashed version
- `{{ .SiteURL }}`         — value of Supabase Site URL setting
- `{{ .RedirectTo }}`      — value of redirectTo param

The templates here use only `{{ .ConfirmationURL }}` and `{{ .Email }}` — safest.
