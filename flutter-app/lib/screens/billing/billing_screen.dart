import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

class BillingScreen extends StatefulWidget {
  const BillingScreen({super.key});
  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  Map<String, dynamic>? _tenant;
  Map<String, dynamic>? _minutes;
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final sb   = Supabase.instance.client;
    final user = sb.auth.currentUser;
    if (user == null) return;
    final tu = await sb.from('tenant_users').select('tenant_id').eq('user_id', user.id).single();
    final month = DateTime.now().toIso8601String().substring(0, 7);
    final results = await Future.wait([
      sb.from('tenants').select('*').eq('id', tu['tenant_id']).single(),
      sb.from('call_minutes').select('*').eq('tenant_id', tu['tenant_id']).eq('month', month).maybeSingle(),
    ]);
    if (mounted) setState(() {
      _tenant  = results[0] as Map<String, dynamic>?;
      _minutes = results[1] as Map<String, dynamic>?;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final usedSec  = _minutes?['used_seconds'] as int? ?? 0;
    final limitSec = _minutes?['plan_limit_seconds'] as int? ?? 12000;
    final pct      = limitSec > 0 ? (usedSec / limitSec).clamp(0.0, 1.0) : 0.0;
    final plan     = _tenant?['plan'] ?? 'trial';
    final daysLeft = _tenant?['trial_ends_at'] != null
      ? DateTime.parse(_tenant!['trial_ends_at']).difference(DateTime.now()).inDays
      : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Billing')),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: HeyNikkiColors.teal))
        : SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // Current plan
              HeyNikkiCard(
                borderColor: HeyNikkiColors.teal.withOpacity(0.4),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('CURRENT PLAN', style: TextStyle(color: HeyNikkiColors.dim, fontSize: 10, letterSpacing: 0.8)),
                    const SizedBox(height: 6),
                    Text(plan.toUpperCase(), style: const TextStyle(color: HeyNikkiColors.text, fontSize: 20, fontWeight: FontWeight.w900)),
                    if (daysLeft != null && plan == 'trial')
                      Text('$daysLeft days left', style: const TextStyle(color: HeyNikkiColors.gold, fontSize: 12)),
                  ])),
                  Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(gradient: HeyNikkiColors.gradient, borderRadius: BorderRadius.circular(8)),
                    child: const Text('Upgrade', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700))),
                ]),
              ),
              const SizedBox(height: 16),

              // Usage ring
              HeyNikkiCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('MINUTES THIS MONTH', style: TextStyle(color: HeyNikkiColors.dim, fontSize: 10, letterSpacing: 0.8)),
                  const SizedBox(height: 16),
                  Row(children: [
                    SizedBox(
                      width: 80, height: 80,
                      child: Stack(alignment: Alignment.center, children: [
                        CircularProgressIndicator(
                          value: pct, strokeWidth: 8,
                          backgroundColor: HeyNikkiColors.border,
                          valueColor: AlwaysStoppedAnimation(pct > 0.9 ? HeyNikkiColors.red : pct > 0.7 ? HeyNikkiColors.gold : HeyNikkiColors.teal),
                        ),
                        Text('${(pct * 100).round()}%', style: const TextStyle(color: HeyNikkiColors.text, fontSize: 14, fontWeight: FontWeight.w800)),
                      ]),
                    ),
                    const SizedBox(width: 20),
                    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${usedSec ~/ 60} / ${limitSec ~/ 60} min',
                        style: const TextStyle(color: HeyNikkiColors.text, fontSize: 20, fontWeight: FontWeight.w900)),
                      const SizedBox(height: 4),
                      Text('${(limitSec - usedSec) ~/ 60} minutes remaining',
                        style: const TextStyle(color: HeyNikkiColors.mid, fontSize: 12)),
                      const SizedBox(height: 4),
                      const Text('Overage: ₹15/min', style: TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
                    ]),
                  ]),
                ]),
              ),
              const SizedBox(height: 20),

              // Plans
              const Text('UPGRADE PLAN', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
              const SizedBox(height: 10),
              ...[
                {'id': 'starter', 'name': 'Starter', 'price': 1999, 'mins': 200, 'color': HeyNikkiColors.mid},
                {'id': 'growth',  'name': 'Growth',  'price': 4999, 'mins': 600, 'color': HeyNikkiColors.teal, 'pop': true},
                {'id': 'scale',   'name': 'Scale',   'price': 9999, 'mins': 1500,'color': HeyNikkiColors.orange},
              ].map((p) {
                final isCurrent = plan == p['id'];
                final col       = p['color'] as Color;
                return HeyNikkiCard(
                  borderColor: isCurrent ? HeyNikkiColors.teal : p['pop'] == true ? col.withOpacity(0.5) : null,
                  padding: const EdgeInsets.all(16),
                  child: Row(children: [
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Text(p['name'] as String, style: TextStyle(color: col, fontSize: 15, fontWeight: FontWeight.w900)),
                        if (p['pop'] == true) ...[
                          const SizedBox(width: 8),
                          HeyNikkiPill(label: 'POPULAR', color: col),
                        ],
                      ]),
                      const SizedBox(height: 4),
                      Text('${p['mins']} min/month · ₹${p['price']}/mo', style: const TextStyle(color: HeyNikkiColors.mid, fontSize: 12)),
                    ])),
                    if (isCurrent)
                      HeyNikkiPill(label: 'CURRENT', color: HeyNikkiColors.teal)
                    else
                      GestureDetector(
                        onTap: () => _handleUpgrade(p['id'] as String),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(gradient: HeyNikkiColors.gradient, borderRadius: BorderRadius.circular(8)),
                          child: const Text('Upgrade', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                        ),
                      ),
                  ]),
                );
              }).toList(),
              const SizedBox(height: 12),
              const Center(child: Text('14-day free trial · Cancel anytime', style: TextStyle(color: HeyNikkiColors.dim, fontSize: 11))),
              const SizedBox(height: 40),
            ]),
          ),
    );
  }

  void _handleUpgrade(String planId) {
    // In production: open Razorpay checkout
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Opening Razorpay checkout for $planId plan...'), backgroundColor: HeyNikkiColors.teal));
  }
}
