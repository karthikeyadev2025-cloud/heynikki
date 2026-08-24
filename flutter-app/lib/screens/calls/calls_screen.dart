import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

class CallsScreen extends StatefulWidget {
  const CallsScreen({super.key});
  @override
  State<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends State<CallsScreen> {
  List<Map<String, dynamic>> _calls = [];
  bool _loading = true;
  String _filter = 'all';
  String? _tenantId;

  final _intentColors = {
    'appointment': HeyNikkiColors.teal,
    'enquiry':     HeyNikkiColors.purple,
    'callback':    HeyNikkiColors.gold,
    'transfer':    HeyNikkiColors.orange,
    'emergency':   HeyNikkiColors.red,
    'unknown':     HeyNikkiColors.dim,
  };

  @override
  void initState() { super.initState(); _init(); }

  Future<void> _init() async {
    final sb   = Supabase.instance.client;
    final user = sb.auth.currentUser;
    if (user == null) return;
    final tu = await sb.from('tenant_users').select('tenant_id').eq('user_id', user.id).single();
    _tenantId = tu['tenant_id'];
    await _load();
  }

  Future<void> _load() async {
    if (_tenantId == null) return;
    final sb = Supabase.instance.client;
    var q = sb.from('calls').select('*').eq('tenant_id', _tenantId!).order('created_at', ascending: false).limit(50);
    if (_filter != 'all') q = q.eq('intent', _filter);
    final data = await q;
    if (mounted) setState(() { _calls = List<Map<String, dynamic>>.from(data); _loading = false; });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Calls'), actions: [
        IconButton(icon: const Icon(Icons.refresh_rounded, color: HeyNikkiColors.mid), onPressed: _load),
      ]),
      body: Column(
        children: [
          // Filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Row(children: ['all','appointment','enquiry','callback','transfer'].map((f) =>
              GestureDetector(
                onTap: () { setState(() => _filter = f); _load(); },
                child: Container(
                  margin: const EdgeInsets.only(right: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                  decoration: BoxDecoration(
                    gradient: _filter == f ? HeyNikkiColors.gradient : null,
                    color: _filter == f ? null : HeyNikkiColors.high,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: _filter == f ? Colors.transparent : HeyNikkiColors.border),
                  ),
                  child: Text(f == 'all' ? 'All' : f[0].toUpperCase() + f.substring(1),
                    style: TextStyle(color: _filter == f ? Colors.white : HeyNikkiColors.mid, fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              )).toList(),
            ),
          ),
          Expanded(
            child: _loading
              ? const Center(child: CircularProgressIndicator(color: HeyNikkiColors.teal))
              : _calls.isEmpty
                ? const Center(child: Text('No calls yet', style: TextStyle(color: HeyNikkiColors.dim)))
                : RefreshIndicator(
                    color: HeyNikkiColors.teal, backgroundColor: HeyNikkiColors.surface,
                    onRefresh: _load,
                    child: ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: _calls.length,
                      itemBuilder: (_, i) {
                        final c = _calls[i];
                        final intent = c['intent'] ?? 'unknown';
                        final col = _intentColors[intent] ?? HeyNikkiColors.dim;
                        final dur = c['duration_seconds'] ?? 0;
                        final durStr = dur > 60 ? '${dur ~/ 60}m ${dur % 60}s' : '${dur}s';
                        return GestureDetector(
                          onTap: () => _showDetail(c),
                          child: HeyNikkiCard(
                            padding: const EdgeInsets.all(14),
                            child: Row(children: [
                              Container(width: 36, height: 36, decoration: BoxDecoration(
                                color: col.withOpacity(0.15), borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: col.withOpacity(0.3))),
                                child: Icon(c['direction'] == 'inbound' ? Icons.call_received_rounded : Icons.call_made_rounded, color: col, size: 18)),
                              const SizedBox(width: 12),
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(c['caller_number'] ?? 'Unknown', style: const TextStyle(color: HeyNikkiColors.text, fontSize: 13, fontWeight: FontWeight.w700)),
                                const SizedBox(height: 3),
                                Text('$durStr · ${_timeAgo(c['created_at'])}', style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
                              ])),
                              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                HeyNikkiPill(label: intent, color: col),
                                if (c['wa_sent'] == true) ...[
                                  const SizedBox(height: 4),
                                  const Text('WA ✓', style: TextStyle(color: HeyNikkiColors.orange, fontSize: 10, fontWeight: FontWeight.w700)),
                                ],
                              ]),
                            ]),
                          ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  void _showDetail(Map<String, dynamic> c) {
    final transcript = (c['transcript'] as List? ?? []);
    showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.transparent,
      builder: (_) => Container(
        height: MediaQuery.of(context).size.height * 0.75,
        decoration: BoxDecoration(color: HeyNikkiColors.surface, borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: HeyNikkiColors.border)),
        child: Column(children: [
          Container(width: 40, height: 4, margin: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(color: HeyNikkiColors.border, borderRadius: BorderRadius.circular(2))),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(c['caller_number'] ?? '', style: const TextStyle(color: HeyNikkiColors.text, fontSize: 16, fontWeight: FontWeight.w800)),
                Text(_timeAgo(c['created_at']), style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 12)),
              ])),
              HeyNikkiPill(label: c['intent'] ?? 'unknown', color: _intentColors[c['intent']] ?? HeyNikkiColors.dim),
            ])),
          const Divider(color: HeyNikkiColors.border, height: 24),
          // Call journey
          Padding(padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(children: [
              for (final step in _buildJourney(c)) ...[
                HeyNikkiPill(label: step, color: HeyNikkiColors.purple),
                if (step != _buildJourney(c).last) const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 4),
                  child: Text('→', style: TextStyle(color: HeyNikkiColors.dim, fontSize: 10))),
              ],
            ])),
          const SizedBox(height: 16),
          Expanded(
            child: transcript.isEmpty
              ? const Center(child: Text('No transcript available', style: TextStyle(color: HeyNikkiColors.dim)))
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  itemCount: transcript.length,
                  itemBuilder: (_, i) {
                    final t = transcript[i];
                    final isAgent = t['role'] == 'assistant';
                    return Align(
                      alignment: isAgent ? Alignment.centerLeft : Alignment.centerRight,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.72),
                        decoration: BoxDecoration(
                          gradient: isAgent ? HeyNikkiColors.gradient : null,
                          color: isAgent ? null : HeyNikkiColors.high,
                          borderRadius: BorderRadius.circular(12),
                          border: isAgent ? null : Border.all(color: HeyNikkiColors.border),
                        ),
                        child: Text(t['content'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.4)),
                      ),
                    );
                  },
                ),
          ),
        ]),
      ),
    );
  }

  List<String> _buildJourney(Map<String, dynamic> c) {
    final steps = ['Received'];
    if (c['intent'] != null) steps.add(c['intent'][0].toUpperCase() + c['intent'].substring(1));
    if (c['appointment_created'] == true) steps.add('Booked');
    if (c['wa_sent'] == true) steps.add('WA Sent');
    steps.add('Ended');
    return steps;
  }

  String _timeAgo(String? ts) {
    if (ts == null) return '';
    final diff = DateTime.now().difference(DateTime.parse(ts));
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24)   return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}
