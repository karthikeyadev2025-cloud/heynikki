import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});
  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _business = TextEditingController();
  final _email    = TextEditingController();
  final _password = TextEditingController();
  bool _loading   = false;
  bool _done      = false;
  String? _error;

  Future<void> _signup() async {
    setState(() { _loading = true; _error = null; });
    try {
      await Supabase.instance.client.auth.signUp(
        email: _email.text.trim(),
        password: _password.text,
        data: {'business_name': _business.text.trim()},
      );
      if (mounted) setState(() => _done = true);
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_done) return Scaffold(
      body: Center(child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          const HeyNikkiLogo(size: 56),
          const SizedBox(height: 32),
          const Text('✉️', style: TextStyle(fontSize: 52)),
          const SizedBox(height: 20),
          const Text('Check your email', style: TextStyle(color: HeyNikkiColors.text, fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 10),
          Text('We sent a confirmation to ${_email.text}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: HeyNikkiColors.mid, fontSize: 14, height: 1.6)),
          const SizedBox(height: 28),
          HeyNikkiButton(label: 'Go to Sign In', onTap: () => context.go('/login')),
        ]),
      )),
    );

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SizedBox(height: 20),
            const Center(child: HeyNikkiLogo(size: 48)),
            const SizedBox(height: 40),
            const Text('Create Account', style: TextStyle(color: HeyNikkiColors.text, fontSize: 26, fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            const Text('14-day free trial · No credit card', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 13)),
            const SizedBox(height: 28),
            if (_error != null) ...[
              Container(padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: HeyNikkiColors.red.withOpacity(0.15), borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: HeyNikkiColors.red.withOpacity(0.4))),
                child: Text(_error!, style: const TextStyle(color: HeyNikkiColors.red, fontSize: 13))),
              const SizedBox(height: 16),
            ],
            TextField(controller: _business, style: const TextStyle(color: HeyNikkiColors.text),
              decoration: const InputDecoration(labelText: 'Business Name', hintText: 'Ravi Clinic, Hyderabad',
                prefixIcon: Icon(Icons.business_outlined, color: HeyNikkiColors.dim))),
            const SizedBox(height: 14),
            TextField(controller: _email, keyboardType: TextInputType.emailAddress, style: const TextStyle(color: HeyNikkiColors.text),
              decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.email_outlined, color: HeyNikkiColors.dim))),
            const SizedBox(height: 14),
            TextField(controller: _password, obscureText: true, style: const TextStyle(color: HeyNikkiColors.text),
              decoration: const InputDecoration(labelText: 'Password (min 8 chars)', prefixIcon: Icon(Icons.lock_outline, color: HeyNikkiColors.dim))),
            const SizedBox(height: 24),
            HeyNikkiButton(label: 'Start Free Trial →', onTap: _signup, loading: _loading),
            const SizedBox(height: 20),
            Center(
              child: GestureDetector(
                onTap: () => context.go('/login'),
                child: const Text.rich(TextSpan(children: [
                  TextSpan(text: 'Already have an account? ', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 13)),
                  TextSpan(text: 'Sign In', style: TextStyle(color: HeyNikkiColors.teal, fontWeight: FontWeight.w700, fontSize: 13)),
                ])),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
