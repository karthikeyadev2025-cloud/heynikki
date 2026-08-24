import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email    = TextEditingController();
  final _password = TextEditingController();
  bool _loading   = false;
  String? _error;

  Future<void> _login() async {
    setState(() { _loading = true; _error = null; });
    try {
      await Supabase.instance.client.auth.signInWithPassword(
        email: _email.text.trim(), password: _password.text);
      if (mounted) context.go('/home');
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _googleLogin() async {
    await Supabase.instance.client.auth.signInWithOAuth(OAuthProvider.google);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 20),
              const Center(child: HeyNikkiLogo(size: 48)),
              const SizedBox(height: 40),
              const Text('Sign In', style: TextStyle(color: HeyNikkiColors.text, fontSize: 26, fontWeight: FontWeight.w900)),
              const SizedBox(height: 6),
              const Text('Welcome back to Hey Nikki', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 14)),
              const SizedBox(height: 28),
              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: HeyNikkiColors.red.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: HeyNikkiColors.red.withOpacity(0.4)),
                  ),
                  child: Text(_error!, style: const TextStyle(color: HeyNikkiColors.red, fontSize: 13)),
                ),
                const SizedBox(height: 16),
              ],
              TextField(controller: _email, keyboardType: TextInputType.emailAddress,
                style: const TextStyle(color: HeyNikkiColors.text),
                decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.email_outlined, color: HeyNikkiColors.dim))),
              const SizedBox(height: 14),
              TextField(controller: _password, obscureText: true,
                style: const TextStyle(color: HeyNikkiColors.text),
                onSubmitted: (_) => _login(),
                decoration: const InputDecoration(labelText: 'Password', prefixIcon: Icon(Icons.lock_outline, color: HeyNikkiColors.dim))),
              const SizedBox(height: 24),
              HeyNikkiButton(label: 'Sign In', onTap: _login, loading: _loading),
              const SizedBox(height: 8),
              Center(
                child: GestureDetector(
                  onTap: () => context.go('/forgot-password'),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      'Forgot password?',
                      style: TextStyle(color: HeyNikkiColors.mid, fontSize: 12, decoration: TextDecoration.underline),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(children: const [
                Expanded(child: Divider(color: HeyNikkiColors.border)),
                Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: TextStyle(color: HeyNikkiColors.dim, fontSize: 12))),
                Expanded(child: Divider(color: HeyNikkiColors.border)),
              ]),
              const SizedBox(height: 16),
              GestureDetector(
                onTap: _googleLogin,
                child: Container(
                  height: 50, width: double.infinity,
                  decoration: BoxDecoration(color: HeyNikkiColors.high, borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: HeyNikkiColors.border)),
                  child: const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Text('🔑', style: TextStyle(fontSize: 18)),
                    SizedBox(width: 10),
                    Text('Continue with Google', style: TextStyle(color: HeyNikkiColors.text, fontSize: 14, fontWeight: FontWeight.w600)),
                  ]),
                ),
              ),
              const SizedBox(height: 24),
              Center(
                child: GestureDetector(
                  onTap: () => context.go('/signup'),
                  child: const Text.rich(TextSpan(children: [
                    TextSpan(text: "Don't have an account? ", style: TextStyle(color: HeyNikkiColors.mid, fontSize: 13)),
                    TextSpan(text: 'Start free trial', style: TextStyle(color: HeyNikkiColors.teal, fontWeight: FontWeight.w700, fontSize: 13)),
                  ])),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
