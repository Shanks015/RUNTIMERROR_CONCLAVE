import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';

class IncidentScreen extends StatefulWidget {
  const IncidentScreen({super.key});

  @override
  State<IncidentScreen> createState() => _IncidentScreenState();
}

class _IncidentScreenState extends State<IncidentScreen> {
  final _detail = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _detail.dispose();
    super.dispose();
  }

  Future<void> _send(String type, {String severity = 'high'}) async {
    final state = context.read<AppState>();
    setState(() => _sending = true);
    final report = await state.reportIncident(
      type: type,
      description: _detail.text.trim(),
      severity: severity,
    );
    if (!mounted) return;
    setState(() => _sending = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          report != null
              ? 'Reported: ${type.replaceAll('_', ' ')}'
              : state.activeTripId == null
                  ? 'No active trip to attach this report to.'
                  : 'Could not send report.',
        ),
        backgroundColor: report != null ? Colors.green : Colors.redAccent,
      ),
    );
    if (report != null) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);
    final gps = state.location.gps;

    final buttons = <(String, IconData, String)>[
      ('accident', Icons.car_crash, 'Accident ahead'),
      ('road_blocked', Icons.block, 'Road blocked'),
      ('heavy_congestion', Icons.traffic, 'Heavy congestion'),
      ('wrong_route', Icons.u_turn_left, 'Wrong route'),
      ('vehicle_issue', Icons.build, 'Vehicle issue'),
      ('destination_changed', Icons.edit_location_alt, 'Destination changed'),
      ('need_assistance', Icons.support_agent, 'Need assistance'),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Report incident')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: Icon(
                Icons.location_on,
                color: gps.latitude != null ? Colors.greenAccent : Colors.amber,
              ),
              title: Text(
                gps.latitude != null
                    ? '±${(gps.accuracyM ?? 0).toStringAsFixed(0)} m accuracy · auto-attached'
                    : 'Waiting for GPS fix',
                style: const TextStyle(fontSize: 14),
              ),
              subtitle: Text(
                gps.latitude != null
                    ? '${gps.latitude!.toStringAsFixed(5)}, ${gps.longitude!.toStringAsFixed(5)}'
                    : 'Report will send when a fix is available',
                style: const TextStyle(fontSize: 12),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text('One tap — no typing required while driving',
              style: theme.textTheme.titleSmall),
          const SizedBox(height: 10),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.5,
            children: [
              for (final b in buttons)
                Material(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: _sending
                        ? null
                        : () => _send(
                              b.$1,
                              severity: b.$1 == 'accident' || b.$1 == 'road_blocked'
                                  ? 'high'
                                  : 'medium',
                            ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(b.$2, size: 30, color: theme.colorScheme.error),
                        const SizedBox(height: 8),
                        Text(b.$3,
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 13)),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _detail,
            maxLength: 200,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'Optional short note',
              border: OutlineInputBorder(),
              counterText: '',
            ),
          ),
          if (_sending) const Center(child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator())),
        ],
      ),
    );
  }
}
