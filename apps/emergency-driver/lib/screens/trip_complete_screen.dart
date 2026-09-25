import 'package:flutter/material.dart';

import '../models/models.dart';

class TripCompleteScreen extends StatefulWidget {
  const TripCompleteScreen({super.key});

  @override
  State<TripCompleteScreen> createState() => _TripCompleteScreenState();
}

class _TripCompleteScreenState extends State<TripCompleteScreen> {
  final _feedback = TextEditingController();
  bool _submitted = false;

  @override
  void dispose() {
    _feedback.dispose();
    super.dispose();
  }

  String _duration(int? seconds) {
    if (seconds == null) return '--';
    final m = seconds ~/ 60;
    final s = seconds % 60;
    if (m == 0) return '$s sec';
    return '$m min ${s.toString().padLeft(2, '0')} sec';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final summary = ModalRoute.of(context)?.settings.arguments as TripSummary?;

    if (summary == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Trip')),
        body: const Center(child: Text('No trip summary available.')),
      );
    }

    final reason = endTripReasons[summary.completionStatus ?? ''] ??
        (summary.status == 'completed' ? 'Completed' : 'Trip ${summary.status}');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Trip complete'),
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Icon(
            summary.status == 'completed' ? Icons.check_circle : Icons.info,
            size: 56,
            color: summary.status == 'completed' ? Colors.greenAccent : Colors.amber,
          ),
          const SizedBox(height: 8),
          Text(
            reason,
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          Text(
            summary.destinationName,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white54),
          ),
          const SizedBox(height: 20),
          Card(
            child: Column(
              children: [
                _row('Trip ID', summary.tripId),
                _row('Total time', _duration(summary.durationSeconds)),
                _row('Distance travelled',
                    '${(summary.distanceTravelledM / 1000).toStringAsFixed(2)} km'),
                _row('Emergency type',
                    emergencyTypes[summary.emergencyType] ?? summary.emergencyType),
                _row('Priority', priorityLevels[summary.priority] ?? summary.priority),
                _row(
                  'Original ETA',
                  summary.originalEtaSeconds != null
                      ? '${summary.originalEtaSeconds! ~/ 60} min'
                      : '--',
                ),
                _row(
                  'Final ETA at completion',
                  summary.finalEtaSeconds != null
                      ? '${summary.finalEtaSeconds! ~/ 60} min'
                      : 'Arrived',
                ),
                _row('Route changes', '${summary.routeChanges}'),
                _row('Incident reports', '${summary.incidents.length}'),
                _row('Priority junctions', '${summary.priorityJunctions.length}'),
                _row('Signal plan', summary.signalPlanStatus),
              ],
            ),
          ),
          if (summary.incidents.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Incidents during trip', style: theme.textTheme.titleSmall),
            const SizedBox(height: 6),
            ...summary.incidents.map(
              (i) => ListTile(
                dense: true,
                leading: const Icon(Icons.warning_amber, size: 18, color: Colors.amber),
                title: Text(
                  i.type.replaceAll('_', ' '),
                  style: const TextStyle(fontSize: 14),
                ),
                subtitle: Text(i.severity, style: const TextStyle(fontSize: 12)),
              ),
            ),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _feedback,
            maxLines: 3,
            maxLength: 300,
            decoration: const InputDecoration(
              labelText: 'Feedback (optional)',
              border: OutlineInputBorder(),
              counterText: '',
            ),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _submitted
                ? null
                : () {
                    setState(() => _submitted = true);
                    // Prototype: feedback is acknowledged locally; no PII is sent.
                  },
            child: Text(_submitted ? 'Feedback submitted' : 'Submit feedback'),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: () => Navigator.of(context).pushNamedAndRemoveUntil(
              '/home',
              (route) => false,
            ),
            child: const Text('Back to home'),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => ListTile(
        dense: true,
        title: Text(label, style: const TextStyle(fontSize: 13, color: Colors.white54)),
        trailing: Text(
          value,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
      );
}
