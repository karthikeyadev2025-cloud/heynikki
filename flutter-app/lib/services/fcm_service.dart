import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:go_router/go_router.dart';

/// Top-level handler — FCM requires this be a free function annotated
/// @pragma('vm:entry-point') so it can be invoked from a background isolate.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Keep this MINIMAL. The isolate is short-lived; do not touch UI here.
  // If you need to update local DB / show a custom notification, do it
  // through a platform-specific notification plugin — flutter's default
  // already shows the system tray notification automatically.
  debugPrint('[FCM-bg] ${message.messageId}: ${message.notification?.title}');
}

class FcmService {
  FcmService._();
  static final FcmService instance = FcmService._();

  final _messaging = FirebaseMessaging.instance;
  String?  _currentToken;
  bool     _initialized = false;

  /// One-time init. Call from main() AFTER Firebase.initializeApp().
  /// Safe to call again — second call is a no-op.
  Future<void> init({GlobalKey<NavigatorState>? navigatorKey}) async {
    if (_initialized) return;
    _initialized = true;

    // Set the background handler before anything else
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

    // Foreground messages — show as snackbar (system tray is suppressed in foreground)
    FirebaseMessaging.onMessage.listen((msg) {
      debugPrint('[FCM-fg] ${msg.notification?.title}: ${msg.notification?.body}');
      final ctx = navigatorKey?.currentContext;
      if (ctx != null && msg.notification != null) {
        ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(
          content: Text(
            '${msg.notification!.title ?? 'Hey Nikki'}: ${msg.notification!.body ?? ''}',
          ),
          duration: const Duration(seconds: 4),
          action: SnackBarAction(
            label: 'OPEN',
            onPressed: () => _routeFromMessage(ctx, msg),
          ),
        ));
      }
    });

    // Tap on push from background — open the right screen
    FirebaseMessaging.onMessageOpenedApp.listen((msg) {
      final ctx = navigatorKey?.currentContext;
      if (ctx != null) _routeFromMessage(ctx, msg);
    });

    // Tap on push that LAUNCHED the app from a fully-closed state
    final initial = await _messaging.getInitialMessage();
    if (initial != null) {
      // Defer until first frame so router is mounted
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = navigatorKey?.currentContext;
        if (ctx != null) _routeFromMessage(ctx, initial);
      });
    }
  }

  /// Request permission + return the FCM token (or null if denied/error).
  /// Call this after successful sign-in.
  Future<String?> requestAndGetToken() async {
    try {
      final settings = await _messaging.requestPermission(
        alert: true, badge: true, sound: true,
      );
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        return null;
      }

      // APNs token on iOS needs to be ready before FCM token is reliable
      if (Platform.isIOS) {
        await _messaging.getAPNSToken();
      }
      _currentToken = await _messaging.getToken();

      // Token can rotate — listen and re-register
      _messaging.onTokenRefresh.listen((newToken) async {
        _currentToken = newToken;
        await _persistToken(newToken);
      });

      return _currentToken;
    } catch (e) {
      debugPrint('[FCM] requestAndGetToken failed: $e');
      return null;
    }
  }

  /// Register the current device token in Supabase under the signed-in user.
  /// Upserts on (user_id, platform) so re-installs replace stale tokens.
  Future<void> registerWithSupabase() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;
    final token = _currentToken ?? await requestAndGetToken();
    if (token == null) return;
    await _persistToken(token);
  }

  Future<void> _persistToken(String token) async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;
    try {
      await Supabase.instance.client.from('device_tokens').upsert({
        'user_id':  user.id,
        'platform': Platform.isIOS ? 'ios' : 'android',
        'token':    token,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }, onConflict: 'user_id,platform');
    } catch (e) {
      debugPrint('[FCM] persist failed: $e');
    }
  }

  /// Clear this device's token when the user signs out. Important so
  /// notifications don't keep going to a device with no logged-in user.
  Future<void> unregisterFromSupabase(String userId) async {
    try {
      await Supabase.instance.client
        .from('device_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('platform', Platform.isIOS ? 'ios' : 'android');
    } catch (e) {
      debugPrint('[FCM] unregister failed: $e');
    }

    try {
      await _messaging.deleteToken();
      _currentToken = null;
    } catch (e) {
      debugPrint('[FCM] deleteToken failed: $e');
    }
  }

  /// Decide where a notification should navigate to based on its `data` payload.
  /// Sender (api-server) should include `type` field, e.g.:
  ///   { "type": "missed_call",  "call_id": "uuid" }
  ///   { "type": "appointment",  "appointment_id": "uuid" }
  ///   { "type": "billing",      "subscription_id": "uuid" }
  void _routeFromMessage(BuildContext ctx, RemoteMessage msg) {
    final type = msg.data['type'] ?? '';
    switch (type) {
      case 'missed_call':
      case 'completed_call':
        GoRouter.of(ctx).go('/calls');
        break;
      case 'appointment':
        GoRouter.of(ctx).go('/home');
        break;
      case 'billing':
        GoRouter.of(ctx).go('/billing');
        break;
      default:
        GoRouter.of(ctx).go('/home');
    }
  }
}
