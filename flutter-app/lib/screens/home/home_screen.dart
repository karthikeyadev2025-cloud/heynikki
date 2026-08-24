import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';
import '../../providers/auth_provider.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  List<Map<String, dynamic>> _activeCalls   = [];
  List<Map<String, dynamic>> _missedCalls   = [];
  List<Map<String, dynamic>> _appointments  = [];
  Map<String, int> _stats = {};
  bool _loading = true;
  String? _tenantId;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final sb   = Supabase.instance.client;
    final user = sb.auth.currentUser;
    if (user == null) return;
    final tu = await sb.from('tenant_users').select('tenant_id').eq('user_id', user.id).single();
    _tenantId = tu['tenant_id'];
    await _load();
    // Real-time subscription
    sb.channel('home-calls').on(RealtimeListenTypes.postgresChanges,
      ChannelFilter(event: '*', schema: 'public', table: 'calls',
        filter: 'tenant_id=eq.$_tenantId'),
      (_, __, ___) => _load()).subscribe();
  }

  Future<void> _load() async {
    if (_tenantId == null) return;
    final sb  = Supabase.instance.client;
    final today = DateTime.now().toIso8601String().split('T')[0];

    final results = await Future.wait([
      sb.from('calls').select('*').eq('tenant_id', _tenantId!).eq('status', 'active'),
      sb.from('calls').select('*').eq('tenant_id', _tenantId!).eq('status', 'missed')
          .order('created_at', ascending: false).limit(8),
      sb.from('appointments').select('*').eq('tenant_id', _tenantId!)
          .order('created_at', ascending: false).limit(8),
      sb.from('calls').select('id,status,wa_sent,appointment_created')
          .eq('tenant_id', _tenantId!).gte('created_at', '${today}T00:00:00'),
    ]);

    final todayCalls = results[3] as List;
    if (mounted) setState(() {
      _activeCalls  = List<Map<String, dynamic>>.from(results[0] as List);
      _missedCalls  = List<Map<String, dynamic>>.from(results[1] as List);
      _appointments = List<Map<String, dynamic>>.from(results[2] as List);
      _stats = {
        'total':        todayCalls.length,
        'appointments': todayCalls.where((c) => c['appointment_created'] == true).length,
        'missed':       todayCalls.where((c) => c['status'] == 'missed').length,
        'wa_sent':      todayCalls.where((c) => c['wa_sent'] == true).length,
      };
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const HeyNikkiLogo(size: 32),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded, color: HeyNikkiColors.mid), onPressed: _load),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: HeyNikkiColors.teal))
        : RefreshIndicator(
            color: HeyNikkiColors.teal, backgroundColor: HeyNikkiColors.surface,
            onRefresh: _load,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                // Stats
                GridView.count(
                  crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.6,
                  children: [
                    HeyNikkiStat(value: '${_stats['total'] ?? 0}',        label: 'CALLS TODAY',       color: HeyNikkiColors.purple),
                    HeyNikkiStat(value: '${_stats['appointments'] ?? 0}', label: 'APPOINTMENTS',      color: HeyNikkiColors.teal),
                    HeyNikkiStat(value: '${_stats['missed'] ?? 0}',       label: 'MISSED (HANDLED)',  color: HeyNikkiColors.gold),
                    HeyNikkiStat(value: '${_stats['wa_sent'] ?? 0}',      label: 'WHATSAPP SENT',     color: HeyNikkiColors.orange),
                  ],
                ),
                const SizedBox(height: 20),

                // Live calls
                if (_activeCalls.isNotEmpty) ...[
                  _sectionHeader('🟢 Active Calls', _activeCalls.length),
                  ..._activeCalls.map((c) => _liveCallCard(c)),
                  const SizedBox(height: 16),
                ],

                // Appointments
                _sectionHeader('📅 Appointment Ledger', _appointments.length),
                if (_appointments.isEmpty)
                  _emptyState('No appointments yet today')
                else
                  ..._appointments.map((a) => _appointmentCard(a)),
                const SizedBox(height: 16),

                // Missed calls
                _sectionHeader('📵 Missed Calls — AI Handled', _missedCalls.length),
                if (_missedCalls.isEmpty)
                  _emptyState('No missed calls 🎉')
                else
                  ..._missedCalls.map((c) => _missedCard(c)),
                const SizedBox(height: 24),
              ]),
            ),
          ),
    );
  }

  Widget _sectionHeader(String title, int count) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Text(title, style: const TextStyle(color: HeyNikkiColors.text, fontSize: 14, fontWeight: FontWeight.w800)),
      HeyNikkiPill(label: '$count', color: HeyNikkiColors.teal),
    ]),
  );

  Widget _emptyState(String msg) => HeyNikkiCard(
    child: Center(child: Padding(
      padding: const EdgeInsets.all(16),
      child: Text(msg, style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 13)),
    )),
  );

  Widget _liveCallCard(Map<String, dynamic> c) => HeyNikkiCard(
    borderColor: HeyNikkiColors.teal.withOpacity(0.4),
    padding: const EdgeInsets.all(12),
    child: Row(children: [
      Container(width: 8, height: 8, decoration: BoxDecoration(
        color: HeyNikkiColors.teal, shape: BoxShape.circle,
        boxShadow: [BoxShadow(color: HeyNikkiColors.teal.withOpacity(0.5), blurRadius: 8)])),
      const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(c['caller_number'] ?? 'Unknown', style: const TextStyle(color: HeyNikkiColors.text, fontSize: 13, fontWeight: FontWeight.w700)),
        Text('${c['direction']} · ${c['intent'] ?? 'active'}', style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
      ])),
      HeyNikkiPill(label: 'LIVE', color: HeyNikkiColors.teal),
    ]),
  );

  Widget _appointmentCard(Map<String, dynamic> a) {
    final colors = {'confirmed': HeyNikkiColors.teal, 'cancelled': HeyNikkiColors.red};
    final col    = colors[a['status']] ?? HeyNikkiColors.gold;
    return HeyNikkiCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(a['caller_name'] ?? a['caller_number'] ?? '',
            style: const TextStyle(color: HeyNikkiColors.text, fontSize: 13, fontWeight: FontWeight.w700)),
          Text('${a['service'] ?? 'General'} · ${a['slot_date'] ?? ''} ${a['slot_time'] ?? ''}',
            style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
        ])),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          HeyNikkiPill(label: a['status'] ?? 'confirmed', color: col),
          if (a['wa_confirmed'] == true) ...[
            const SizedBox(height: 4),
            const Text('WA ✓', style: TextStyle(color: HeyNikkiColors.teal, fontSize: 10, fontWeight: FontWeight.w700)),
          ],
        ]),
      ]),
    );
  }

  Widget _missedCard(Map<String, dynamic> c) => HeyNikkiCard(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    child: Row(children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(c['caller_number'] ?? 'Unknown', style: const TextStyle(color: HeyNikkiColors.text, fontSize: 13, fontWeight: FontWeight.w700)),
        Text(_timeAgo(c['created_at']), style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
      ])),
      if (c['wa_sent'] == true)
        const HeyNikkiPill(label: 'WA SENT', color: HeyNikkiColors.orange),
    ]),
  );

  String _timeAgo(String? ts) {
    if (ts == null) return '';
    final diff = DateTime.now().difference(DateTime.parse(ts));
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24)   return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}
