import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../core/recents.dart';
import '../models/models.dart';
import '../state/app_state.dart';

class StartTripScreen extends StatefulWidget {
  const StartTripScreen({super.key});

  @override
  State<StartTripScreen> createState() => _StartTripScreenState();
}

class _StartTripScreenState extends State<StartTripScreen> {
  static const _presets = <(String, double, double)>[
    ('City Hospital', 12.9719, 77.5937),
    ('Metro General Hospital', 12.9783, 77.6408),
    ('Fire Station HQ', 12.9766, 77.5993),
    ('Central Police Control', 12.9762, 77.6033),
  ];

  String _emergencyType = 'critical_medical';
  String _priority = 'critical';
  final _notes = TextEditingController();
  final _contact = TextEditingController();
  final _restriction = TextEditingController();
  final _search = TextEditingController();
  Destination? _destination;
  List<Destination> _recents = [];
  String _query = '';

  @override
  void initState() {
    super.initState();
    final p = _presets.first;
    _destination = Destination(name: p.$1, latitude: p.$2, longitude: p.$3);
    Recents.load().then((list) {
      if (mounted) setState(() => _recents = list);
    });
  }

  @override
  void dispose() {
    _notes.dispose();
    _contact.dispose();
    _restriction.dispose();
    _search.dispose();
    super.dispose();
  }

  List<(String, Destination, bool)> get _matches {
    final all = <(String, Destination, bool)>[
      for (final p in _presets)
        ('saved', Destination(name: p.$1, latitude: p.$2, longitude: p.$3), true),
      for (final r in _recents) ('recent', r, false),
    ];
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return all;
    return all.where((e) => e.$2.name.toLowerCase().contains(q)).toList();
  }

  void _pick(Destination d) {
    setState(() {
      _destination = d;
      _search.text = d.name;
      _query = d.name;
    });
    FocusScope.of(context).unfocus();
  }

  void _review() {
    final dest = _destination;
    if (dest == null) return;
    final draft = TripDraft(
      destination: dest,
      emergencyType: _emergencyType,
      priority: _priority,
      notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      destinationContact: _contact.text.trim().isEmpty ? null : _contact.text.trim(),
      routeRestriction: _restriction.text.trim().isEmpty ? null : _restriction.text.trim(),
    );
    Navigator.of(context).pushNamed('/confirm', arguments: draft);
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);
    final origin = LatLng(
      state.location.gps.latitude ?? 12.9852,
      state.location.gps.longitude ?? 77.6051,
    );
    final matches = _matches;

    return Scaffold(
      appBar: AppBar(title: const Text('Start emergency trip')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Emergency type', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _emergencyType,
            decoration: const InputDecoration(border: OutlineInputBorder()),
            items: emergencyTypes.entries
                .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                .toList(),
            onChanged: (v) => setState(() => _emergencyType = v!),
          ),
          const SizedBox(height: 16),
          Text('Priority', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: priorityLevels.entries
                .map((e) => ButtonSegment(value: e.key, label: Text(e.value)))
                .toList(),
            selected: {_priority},
            onSelectionChanged: (s) => setState(() => _priority = s.first),
          ),
          const SizedBox(height: 6),
          Text(
            'Critical priority is only accepted for critical medical, fire and organ transport.',
            style: theme.textTheme.bodySmall?.copyWith(color: Colors.white38),
          ),
          const SizedBox(height: 16),
          Text('Destination', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          TextField(
            controller: _search,
            decoration: const InputDecoration(
              labelText: 'Search hospital, station or address',
              hintText: 'City Hospital',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
            ),
            onChanged: (v) => setState(() => _query = v),
          ),
          if (_query.trim().isNotEmpty && matches.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E1E),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.white12),
              ),
              child: Column(
                children: [
                  for (final (_, dest, saved) in matches.take(6))
                    ListTile(
                      dense: true,
                      leading: Icon(
                        saved ? Icons.star_outline : Icons.history,
                        size: 18,
                        color: Colors.white54,
                      ),
                      title: Text(dest.name, style: const TextStyle(fontSize: 14)),
                      trailing: Text(
                        saved ? 'saved' : 'recent',
                        style: const TextStyle(fontSize: 11, color: Colors.white38),
                      ),
                      onTap: () => _pick(dest),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            height: 240,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: FlutterMap(
                options: MapOptions(
                  initialCenter: origin,
                  initialZoom: 13,
                  onTap: (tap, point) => _pick(Destination(
                    name: 'Pinned location',
                    latitude: point.latitude,
                    longitude: point.longitude,
                  )),
                ),
                children: [
                  TileLayer(
                    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'in.conclave.resqconnect',
                  ),
                  MarkerLayer(
                    markers: [
                      Marker(
                        point: origin,
                        width: 34,
                        height: 34,
                        child: const Icon(Icons.location_on, color: Colors.blueAccent, size: 34),
                      ),
                      if (_destination != null)
                        Marker(
                          point: LatLng(_destination!.latitude, _destination!.longitude),
                          width: 34,
                          height: 34,
                          child: const Icon(Icons.flag, color: Colors.redAccent, size: 34),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Tap the map to pin a custom destination.',
            style: theme.textTheme.bodySmall?.copyWith(color: Colors.white38),
          ),
          if (_destination != null) ...[
            const SizedBox(height: 8),
            Text(
              'Destination: ${_destination!.name}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _contact,
            decoration: const InputDecoration(
              labelText: 'Destination contact (optional)',
              hintText: 'Receiving ward phone number',
              prefixIcon: Icon(Icons.phone_outlined),
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _restriction,
            decoration: const InputDecoration(
              labelText: 'Special route restriction (optional)',
              hintText: 'Avoid flyovers, low clearance, school zone',
              prefixIcon: Icon(Icons.alt_route_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _notes,
            maxLength: 200,
            decoration: const InputDecoration(
              labelText: 'Notes (optional)',
              border: OutlineInputBorder(),
              counterText: '',
            ),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              backgroundColor: theme.colorScheme.error,
            ),
            icon: const Icon(Icons.rule),
            label: const Text(
              'Review request',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            onPressed: _destination == null ? null : _review,
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}
