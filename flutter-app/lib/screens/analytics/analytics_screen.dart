import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});
  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  List<Map<String, dynamic>> _calls = [];
  bool _loading = true;
  String? _tenantId;

  @override
  void initState() { super.initState(); _init(); }

  Future<void> _init() async {
    final sb   = Supabase.instance.client;
    final user = sb.auth.currentUser;
    if (user == null) return;
    final tu = await sb.from('tenant_users').select('tenant_id').eq('user_id', user.id).single();
    _tenantId = tu['tenant_id'];
    final data = await sb.from('calls').select('created_at,intent,duration_seconds,wa_sent,appointment_created')
        .eq('tenant_id', _tenantId!).gte('created_at', DateTime.now().subtract(const Duration(days: 30)).toIso8601String());
    if (mounted) setState(() { _calls = List<Map<String, dynamic>>.from(data); _loading = false; });
  }

  List<FlSpot> get _weekSpots {
    return List.generate(7, (i) {
      final d = DateTime.now().subtract(Duration(days: 6 - i));
      final ds = d.toIso8601String().split('T')[0];
      final count = _calls.where((c) => (c['created_at'] as String?)?.startsWith(ds) == true).length;
      return FlSpot(i.toDouble(), count.toDouble());
    });
  }

  Map<String, int> get _intentCounts {
    final m = <String, int>{};
    for (final c in _calls) { final k = c['intent'] as String? ?? 'unknown'; m[k] = (m[k] ?? 0) + 1; }
    return m;
  }

  @override
  Widget build(BuildContext context) {
    final total = _calls.length;
    final appts = _calls.where((c) => c['appointment_created'] == true).length;
    final waSent = _calls.where((c) => c['wa_sent'] == true).length;
    final avgDur = total > 0
      ? _calls.map((c) => c['duration_seconds'] as int? ?? 0).reduce((a, b) => a + b) ~/ total
      : 0;
    final intents = _intentCounts;
    final intentColors = [HeyNikkiColors.teal, HeyNikkiColors.orange, HeyNikkiColors.gold, HeyNikkiColors.purple, HeyNikkiColors.red];

    return Scaffold(
      appBar: AppBar(title: const Text('Analytics'), actions: [
        IconButton(icon: const Icon(Icons.refresh_rounded, color: HeyNikkiColors.mid), onPressed: _init),
      ]),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: HeyNikkiColors.teal))
        : SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // KPIs
              GridView.count(
                crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.5,
                children: [
                  HeyNikkiStat(value: '$total',   label: 'CALLS (30 DAYS)',  color: HeyNikkiColors.purple),
                  HeyNikkiStat(value: '$appts',   label: 'APPOINTMENTS',     color: HeyNikkiColors.teal),
                  HeyNikkiStat(value: '$waSent',  label: 'WHATSAPP SENT',    color: HeyNikkiColors.orange),
                  HeyNikkiStat(value: '${avgDur}s', label: 'AVG DURATION',   color: HeyNikkiColors.gold),
                ],
              ),
              const SizedBox(height: 20),

              // 7-day line chart
              HeyNikkiCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Call Volume — Last 7 Days',
                    style: TextStyle(color: HeyNikkiColors.text, fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 160,
                    child: LineChart(LineChartData(
                      gridData: const FlGridData(show: false),
                      titlesData: FlTitlesData(
                        leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 22,
                          getTitlesWidget: (v, _) {
                            final d = DateTime.now().subtract(Duration(days: (6 - v).toInt()));
                            final days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                            return Text(days[d.weekday % 7], style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 10));
                          })),
                      ),
                      borderData: FlBorderData(show: false),
                      lineBarsData: [LineChartBarData(
                        spots: _weekSpots,
                        isCurved: true, color: HeyNikkiColors.teal, barWidth: 2.5,
                        dotData: const FlDotData(show: true),
                        belowBarData: BarAreaData(show: true, color: HeyNikkiColors.teal.withOpacity(0.1)),
                      )],
                    )),
                  ),
                ]),
              ),
              const SizedBox(height: 16),

              // Intent breakdown
              if (intents.isNotEmpty) HeyNikkiCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Intent Breakdown',
                    style: TextStyle(color: HeyNikkiColors.text, fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 14),
                  ...intents.entries.toList().asMap().entries.map((e) {
                    final col = intentColors[e.key % intentColors.length];
                    final pct = total > 0 ? e.value.value / total : 0.0;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(children: [
                        SizedBox(width: 90, child: Text(e.value.key, style: const TextStyle(color: HeyNikkiColors.mid, fontSize: 12))),
                        Expanded(child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(value: pct, minHeight: 8, backgroundColor: HeyNikkiColors.border,
                            valueColor: AlwaysStoppedAnimation(col)),
                        )),
                        const SizedBox(width: 8),
                        Text('${e.value.value}', style: TextStyle(color: col, fontSize: 12, fontWeight: FontWeight.w700)),
                      ]),
                    );
                  }),
                ]),
              ),
              const SizedBox(height: 40),
            ]),
          ),
    );
  }
}
