import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/app_state.dart';

/// Screen 12: emergency assistance — human help without leaving the trip.
class AssistanceScreen extends StatefulWidget {
  const AssistanceScreen({super.key});

  @override
  State<AssistanceScreen> createState() => _AssistanceScreenState();
}

class _AssistanceScreenState extends State<AssistanceScreen> {
  static const controlCenterNumber = '+918045678900';
  static const controlCenterDisplay = '+91 80 4567 8900';

  bool _sending = false;

  Future<void> _call() async {
    final uri = Uri(scheme: 'tel', path: controlCenterNumber);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This device cannot place calls.')),
      );
    }
  }

  Future<void> _requestHelp() async {
    final state = context.read<AppState>();
    setState(() => _sending = true);
    final report = await state.requestAssistance();
    if (!mounted) return;
    setState(() => _sending = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          report != null
              ? 'Assistance request sent to the control center.'
              : state.messages.isNotEmpty
                  ? state.messages.last['text']!
                  : 'No active trip — call the control center instead.',
        ),
      ),
    );
  }

  Future<void> _shareLocation() async {
    final state = context.read<AppState>();
    final hasFix = state.hasFix;
    final text = hasFix
        ? 'ResQConnect assistance — '
            '${state.user?.name ?? "driver"} '
            '(${state.selectedVehicle?.vehicleNumber ?? "vehicle"})\n'
            'Trip: ${state.activeTripId ?? "none"}\n'
            'Location: ${state.latitude.toStringAsFixed(5)}, '
            '${state.longitude.toStringAsFixed(5)}\n'
            'Time: ${DateTime.now().toIso8601String()}'
        : 'ResQConnect assistance — no GPS fix available. Trip: ${state.activeTripId ?? "none"}';
    await SharePlus.instance.share(ShareParams(text: text));
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Emergency assistance')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Icon(Icons.support_agent, size: 42, color: theme.colorScheme.error),
                  const SizedBox(height: 8),
                  const Text(
                    'Control center',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    controlCenterDisplay,
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                  const Text(
                    '24x7 dispatch · answers first',
                    style: TextStyle(fontSize: 12, color: Colors.white54),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              backgroundColor: theme.colorScheme.error,
            ),
            icon: const Icon(Icons.call),
            label: const Text('Call control center'),
            onPressed: _call,
          ),
          const SizedBox(height: 10),
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            icon: _sending
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.pan_tool_alt_outlined),
            label: const Text('Send assistance request in-app'),
            onPressed: _sending ? null : _requestHelp,
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            icon: const Icon(Icons.share_location),
            label: const Text('Share current location'),
            onPressed: _shareLocation,
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Text(
              'The in-app request opens a high-severity incident on your active trip so the operator sees it immediately. '
              'If you have no data connection, use the phone call — it does not need the app to be online.',
              style: TextStyle(fontSize: 13, color: Colors.white70),
            ),
          ),
          if (state.activeTripId != null) ...[
            const SizedBox(height: 12),
            Text(
              'Active trip: ${state.activeTripId}',
              style: const TextStyle(fontSize: 12, color: Colors.white38),
            ),
          ],
        ],
      ),
    );
  }
}
