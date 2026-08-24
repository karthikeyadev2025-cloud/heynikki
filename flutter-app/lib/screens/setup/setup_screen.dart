import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../theme.dart';
import '../../widgets/heynikki_widgets.dart';

const _skus = [
  {'id': 'standard',    'name': 'Hey Nikki Telugu Receptionist — Standard',     'icon': '🏢', 'desc': 'General business, retail, coaching'},
  {'id': 'clinic',      'name': 'Hey Nikki Telugu Receptionist — Clinic',       'icon': '🏥', 'desc': 'Hospitals, clinics, labs'},
  {'id': 'real_estate', 'name': 'Hey Nikki Telugu Receptionist — Real Estate',  'icon': '🏗️', 'desc': 'Site visits, lead capture'},
  {'id': 'premium',     'name': 'Hey Nikki Telugu Receptionist — Premium',      'icon': '⭐', 'desc': 'High-value clients, luxury brands'},
];

const _days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  String _sku         = 'standard';
  String _bizName     = '';
  String _openTime    = '09:00';
  String _closeTime   = '21:00';
  List<String> _days_ = ['Mon','Tue','Wed','Thu','Fri','Sat'];
  String _services    = '';
  String _apptTypes   = '';
  String _waNumber    = '';
  String _didNumber   = '';
  bool _saving        = false;
  bool _saved         = false;
  String? _tenantId;
  String? _profileId;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final sb   = Supabase.instance.client;
    final user = sb.auth.currentUser;
    if (user == null) return;
    final tu = await sb.from('tenant_users').select('tenant_id').eq('user_id', user.id).single();
    _tenantId = tu['tenant_id'];
    try {
      final vp = await sb.from('voice_profiles').select('*').eq('tenant_id', _tenantId!).single();
      if (mounted) setState(() {
        _profileId  = vp['id'];
        _sku        = vp['profile_sku'] ?? 'standard';
        _bizName    = vp['business_name'] ?? '';
        _openTime   = vp['open_time']  ?? '09:00';
        _closeTime  = vp['close_time'] ?? '21:00';
        _days_      = List<String>.from(vp['open_days'] ?? ['Mon','Tue','Wed','Thu','Fri','Sat']);
        _services   = (vp['services'] as List? ?? []).join(', ');
        _apptTypes  = (vp['appointment_types'] as List? ?? []).join(', ');
        _waNumber   = vp['whatsapp_number'] ?? '';
        _didNumber  = vp['did_number'] ?? '';
      });
    } catch (_) {}
  }

  Future<void> _save() async {
    if (_tenantId == null) return;
    setState(() { _saving = true; });
    final sb = Supabase.instance.client;
    final payload = {
      'tenant_id':         _tenantId,
      'profile_sku':       _sku,
      'business_name':     _bizName,
      'open_time':         _openTime,
      'close_time':        _closeTime,
      'open_days':         _days_,
      'services':          _services.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
      'appointment_types': _apptTypes.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
      'whatsapp_number':   _waNumber.isEmpty ? null : _waNumber,
      'did_number':        _didNumber.isEmpty ? null : _didNumber,
      'status':            'active',
    };
    try {
      if (_profileId != null) {
        await sb.from('voice_profiles').update(payload).eq('id', _profileId!);
      } else {
        final r = await sb.from('voice_profiles').insert(payload).select().single();
        _profileId = r['id'];
      }
      if (mounted) setState(() { _saved = true; _saving = false; });
      Future.delayed(const Duration(seconds: 2), () { if (mounted) setState(() => _saved = false); });
    } catch (e) {
      if (mounted) setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: HeyNikkiColors.red));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Voice Profile Setup')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // SKU selector
          const Text('Voice Profile', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
          const SizedBox(height: 10),
          ..._skus.map((sku) => GestureDetector(
            onTap: () => setState(() => _sku = sku['id']!),
            child: HeyNikkiCard(
              borderColor: _sku == sku['id'] ? HeyNikkiColors.teal : null,
              padding: const EdgeInsets.all(14),
              child: Row(children: [
                Text(sku['icon']!, style: const TextStyle(fontSize: 24)),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(sku['name']!, style: const TextStyle(color: HeyNikkiColors.text, fontSize: 12, fontWeight: FontWeight.w700)),
                  Text(sku['desc']!, style: const TextStyle(color: HeyNikkiColors.dim, fontSize: 11)),
                ])),
                if (_sku == sku['id'])
                  Container(width: 20, height: 20, decoration: const BoxDecoration(gradient: HeyNikkiColors.gradient, shape: BoxShape.circle),
                    child: const Icon(Icons.check, color: Colors.white, size: 12)),
              ]),
            ),
          )).toList(),
          const SizedBox(height: 20),

          // Business details
          const Text('Business Details', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
          const SizedBox(height: 10),
          TextField(
            style: const TextStyle(color: HeyNikkiColors.text),
            decoration: const InputDecoration(labelText: 'Business Name', hintText: 'Ravi Clinic, Banjara Hills'),
            onChanged: (v) => _bizName = v,
            controller: TextEditingController(text: _bizName),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(
              style: const TextStyle(color: HeyNikkiColors.text),
              decoration: const InputDecoration(labelText: 'Opens at'),
              onChanged: (v) => _openTime = v,
              controller: TextEditingController(text: _openTime),
            )),
            const SizedBox(width: 12),
            Expanded(child: TextField(
              style: const TextStyle(color: HeyNikkiColors.text),
              decoration: const InputDecoration(labelText: 'Closes at'),
              onChanged: (v) => _closeTime = v,
              controller: TextEditingController(text: _closeTime),
            )),
          ]),
          const SizedBox(height: 12),
          const Text('Open Days', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 12)),
          const SizedBox(height: 8),
          Wrap(spacing: 6, children: _days.map((d) {
            final sel = _days_.contains(d);
            return GestureDetector(
              onTap: () => setState(() => sel ? _days_.remove(d) : _days_.add(d)),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  gradient: sel ? HeyNikkiColors.gradient : null,
                  color: sel ? null : HeyNikkiColors.high,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: sel ? Colors.transparent : HeyNikkiColors.border),
                ),
                child: Text(d, style: TextStyle(color: sel ? Colors.white : HeyNikkiColors.mid, fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            );
          }).toList()),
          const SizedBox(height: 12),
          TextField(
            style: const TextStyle(color: HeyNikkiColors.text),
            decoration: const InputDecoration(labelText: 'Services (comma-separated)', hintText: 'Consultation, Blood Test, ECG'),
            onChanged: (v) => _services = v,
            controller: TextEditingController(text: _services),
          ),
          const SizedBox(height: 12),
          TextField(
            style: const TextStyle(color: HeyNikkiColors.text),
            decoration: const InputDecoration(labelText: 'Appointment Types', hintText: 'New Patient, Follow-up'),
            onChanged: (v) => _apptTypes = v,
            controller: TextEditingController(text: _apptTypes),
          ),
          const SizedBox(height: 20),

          const Text('Phone & WhatsApp', style: TextStyle(color: HeyNikkiColors.mid, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
          const SizedBox(height: 10),
          TextField(
            style: const TextStyle(color: HeyNikkiColors.text),
            decoration: const InputDecoration(labelText: 'Business Phone Number', hintText: '+91 98765 43210', prefixIcon: Icon(Icons.phone_outlined, color: HeyNikkiColors.dim)),
            onChanged: (v) => _didNumber = v,
            controller: TextEditingController(text: _didNumber),
          ),
          const SizedBox(height: 12),
          TextField(
            style: const TextStyle(color: HeyNikkiColors.text),
            decoration: const InputDecoration(labelText: 'WhatsApp Business Number', hintText: '+91 98765 43210', prefixIcon: Icon(Icons.chat_outlined, color: HeyNikkiColors.dim)),
            onChanged: (v) => _waNumber = v,
            controller: TextEditingController(text: _waNumber),
          ),
          const SizedBox(height: 24),
          HeyNikkiButton(
            label: _saved ? '✓ Saved & Live!' : 'Save & Go Live',
            onTap: _save, loading: _saving,
          ),
          const SizedBox(height: 40),
        ]),
      ),
    );
  }
}
