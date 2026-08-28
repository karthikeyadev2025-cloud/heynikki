import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _localAuth   = LocalAuthentication();
  bool _biometric    = false;
  bool _pushNotifs   = true;
  String? _email;
  String? _bizName;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final sb   = Supabase.instance.client;
    final user = sb.auth.currentUser;
    final prefs = await SharedPreferences.getInstance();
    final tu = user != null ? await sb.from('tenant_users').select('tenant_id').eq('user_id', user.id).single() : null;
    final tenant = tu != null ? await sb.from('tenants').select('name').eq('id', tu['tenant_id']).single() : null;
    if (mounted) setState(() {
      _email      = user?.email;
      _bizName    = tenant?['name'];
      _biometric  = prefs.getBool('biometric') ?? false;
      _pushNotifs = prefs.getBool('push_notifs') ?? true;
    });
  }

  Future<void> _toggleBiometric(bool v) async {
    if (v) {
      final ok = await _localAuth.authenticate(localizedReason: 'Enable biometric lock for Hey Nikki');
      if (!ok) return;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('biometric', v);
    setState(() => _biometric = v);
  }

  Future<void> _logout() async {
    await Supabase.instance.client.auth.signOut();
    if (mounted) context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          // Profile
          HeyNikkiCard(
            child: Column(children: [
              Row(children: [
                Container(width: 52, height: 52, decoration: BoxDecoration(gradient: HeyNikkiColors.gradient, borderRadius: BorderRadius.circular(14)),
                  child: Center(child: Text(_bizName?.substring(0,1).toUpperCase() ?? 'N',
                    style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)))),
                const SizedBox(width: 14),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_bizName ?? 'Your Business', style: const TextStyle(color: HeyNikkiColors.text, fontSize: 15, fontWeight: FontWeight.w800)),
                  Text(_email ?? '', style: const TextStyle(color: HeyNikkiColors.mid, fontSize: 12)),
                ])),
              ]),
            ]),
          ),
          const SizedBox(height: 16),

          // Security
          _section('Security', [
            _toggle('Biometric Lock', 'FaceID / Fingerprint to open app', _biometric, _toggleBiometric),
          ]),
          const SizedBox(height: 12),

          // Notifications
          _section('Notifications', [
            _toggle('Push Notifications', 'Live call alerts, appointments', _pushNotifs, (v) async {
              final prefs = await SharedPreferences.getInstance();
              await prefs.setBool('push_notifs', v);
              setState(() => _pushNotifs = v);
            }),
          ]),
          const SizedBox(height: 12),

          // About
          _section('About', [
            _tile('Hey Nikki Version', '1.0.0', Icons.info_outline_rounded),
            _tile('Powered by', 'Nikki Technologies', Icons.rocket_launch_outlined),
            _tile('Support', 'support@heynikki.in', Icons.support_agent_rounded),
          ]),
          const SizedBox(height: 20),

          // Logout
          GestureDetector(
            onTap: _logout,
            child: Container(
              width: double.infinity, height: 50,
              decoration: BoxDecoration(
                color: HeyNikkiColors.red.withOpacity(0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: HeyNikkiColors.red.withOpacity(0.4)),
              ),
              child: const Center(child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(Icons.logout_rounded, color: HeyNikkiColors.red, size: 18),
                SizedBox(width: 8),
                Text('Sign Out', style: TextStyle(color: HeyNikkiColors.red, fontSize: 15, fontWeight: FontWeight.w700)),
              ])),
            ),
          ),
          const SizedBox(height: 12),
          const Text('© 2026 Nikki Technologies', style: TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
          const SizedBox(height: 40),
        ]),
      ),
    );
  }

  Widget _section(String title, List<Widget> items) => HeyNikkiCard(
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title.toUpperCase(), style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
      const SizedBox(height: 12),
      ...items,
    ]),
  );

  Widget _toggle(String title, String sub, bool value, void Function(bool) onChange) => Row(children: [
    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: const TextStyle(color: HeyNikkiColors.text, fontSize: 13, fontWeight: FontWeight.w600)),
      Text(sub, style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
    ])),
    Switch(value: value, onChanged: onChange, activeColor: HeyNikkiColors.teal),
  ]);

  Widget _tile(String title, String val, IconData icon) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(children: [
      Icon(icon, color: HeyNikkiColors.dim, size: 18),
      const SizedBox(width: 12),
      Expanded(child: Text(title, style: const TextStyle(color: HeyNikkiColors.text, fontSize: 13))),
      Text(val, style: const TextStyle(color: HeyNikkiColors.mid, fontSize: 12)),
    ]),
  );
}
