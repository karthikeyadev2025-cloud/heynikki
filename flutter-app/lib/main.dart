import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:go_router/go_router.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'theme.dart';
import 'providers/auth_provider.dart';
import 'services/fcm_service.dart';
import 'widgets/heynikki_widgets.dart';
import 'screens/onboarding/onboarding_screen.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/signup_screen.dart';
import 'screens/auth/forgot_password_screen.dart';
import 'screens/home/home_screen.dart';
import 'screens/calls/calls_screen.dart';
import 'screens/analytics/analytics_screen.dart';
import 'screens/setup/setup_screen.dart';
import 'screens/billing/billing_screen.dart';
import 'screens/settings/settings_screen.dart';

const kSupabaseUrl  = String.fromEnvironment('SUPABASE_URL',  defaultValue: 'https://wnawozdmmxuziucavngw.supabase.co');
const kSupabaseAnon = String.fromEnvironment('SUPABASE_ANON', defaultValue: 'YOUR_ANON_KEY');
const kApiUrl       = String.fromEnvironment('API_URL',       defaultValue: 'https://api.heynikki.in');

/// Navigator key — used by FcmService to route on push tap from any
/// context (incl. background isolate handoff to UI).
final navigatorKey = GlobalKey<NavigatorState>();

// ── ROUTER ────────────────────────────────────────────────
final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);
  return GoRouter(
    navigatorKey: navigatorKey,
    initialLocation: '/onboarding',
    redirect: (context, state) {
      final isAuthed   = authState.valueOrNull != null;
      final isAuthPage = ['/login', '/signup', '/onboarding', '/forgot-password']
          .contains(state.matchedLocation);
      if (!isAuthed && !isAuthPage) return '/login';
      if (isAuthed && isAuthPage && state.matchedLocation != '/forgot-password') return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/onboarding',      builder: (_, __) => const OnboardingScreen()),
      GoRoute(path: '/login',           builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/signup',          builder: (_, __) => const SignupScreen()),
      GoRoute(path: '/forgot-password', builder: (_, __) => const ForgotPasswordScreen()),
      ShellRoute(
        builder: (ctx, state, child) => HeyNikkiShell(child: child, location: state.matchedLocation),
        routes: [
          GoRoute(path: '/home',      builder: (_, __) => const HomeScreen()),
          GoRoute(path: '/calls',     builder: (_, __) => const CallsScreen()),
          GoRoute(path: '/analytics', builder: (_, __) => const AnalyticsScreen()),
          GoRoute(path: '/setup',     builder: (_, __) => const SetupScreen()),
          GoRoute(path: '/billing',   builder: (_, __) => const BillingScreen()),
          GoRoute(path: '/settings',  builder: (_, __) => const SettingsScreen()),
        ],
      ),
    ],
  );
});

// ── ENTRY ─────────────────────────────────────────────────
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.light));
  await Supabase.initialize(url: kSupabaseUrl, anonKey: kSupabaseAnon);
  try {
    await Firebase.initializeApp();
    await FcmService.instance.init(navigatorKey: navigatorKey);
  } catch (e) {
    // Firebase may not be configured in dev — keep app usable
    debugPrint('Firebase/FCM init skipped: $e');
  }
  runApp(const ProviderScope(child: HeyNikkiApp()));
}

class HeyNikkiApp extends ConsumerWidget {
  const HeyNikkiApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Hey Nikki — Telugu AI Receptionist',
      debugShowCheckedModeBanner: false,
      theme: HeyNikkiTheme.dark,
      routerConfig: ref.watch(routerProvider),
    );
  }
}

// ── SHELL WITH BOTTOM NAV ─────────────────────────────────
class HeyNikkiShell extends StatelessWidget {
  final Widget child;
  final String location;
  const HeyNikkiShell({super.key, required this.child, required this.location});

  static const _nav = [
    _N('/home',      Icons.radio_button_checked_rounded, 'Reception'),
    _N('/calls',     Icons.call_rounded,                 'Calls'),
    _N('/analytics', Icons.bar_chart_rounded,            'Analytics'),
    _N('/setup',     Icons.tune_rounded,                 'Setup'),
    _N('/billing',   Icons.credit_card_rounded,          'Billing'),
  ];

  @override
  Widget build(BuildContext context) {
    final idx = _nav.indexWhere((n) => location.startsWith(n.path));
    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: HeyNikkiColors.surface,
          border: Border(top: BorderSide(color: HeyNikkiColors.border)),
        ),
        child: SafeArea(
          child: SizedBox(height: 60, child: Row(
            children: _nav.asMap().entries.map((e) {
              final active = e.key == idx;
              return Expanded(child: GestureDetector(
                onTap: () => context.go(e.value.path),
                behavior: HitTestBehavior.opaque,
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  ShaderMask(
                    shaderCallback: (b) => (active ? HeyNikkiColors.gradient : const LinearGradient(colors: [HeyNikkiColors.dim, HeyNikkiColors.dim])).createShader(b),
                    child: Icon(e.value.icon, size: 22, color: Colors.white),
                  ),
                  const SizedBox(height: 3),
                  Text(e.value.label, style: TextStyle(
                    fontSize: 9, fontWeight: FontWeight.w600,
                    color: active ? HeyNikkiColors.teal : HeyNikkiColors.dim)),
                ]),
              ));
            }).toList(),
          )),
        ),
      ),
    );
  }
}

class _N {
  final String path, label;
  final IconData icon;
  const _N(this.path, this.icon, this.label);
}
