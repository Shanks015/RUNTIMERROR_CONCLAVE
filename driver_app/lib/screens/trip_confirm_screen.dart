import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';

/// Screen 6: request confirmation — the driver sees exactly what will be
/// sent to the central system before anything leaves the phone.
class TripConfirmScreen extends StatelessWidget {
  const TripConfirmScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);
    final draft = ModalRoute.of(context)?.settings.arguments as TripDraft?;
    final vehicle = state.selectedVehicle;

    if (draft == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Confirm request')),
        body: const Center(child: Text('No request to confirm.')),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Confirm emergency request')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: Column(
                children: [
                  _row('Vehicle', '${vehicle?.vehicleNumber ?? '-'} (${vehicle?.typeLabel ?? '-'})'),
                  _row('Driver', state.user?.name ?? '-'),
                  _row('Organization', state.user?.organizationId ?? '-'),
                  _row('Emergency type', emergencyTypes[draft.emergencyType] ?? draft.emergencyType),
                  _row('Priority', priorityLevels[draft.priority] ?? draft.priority),
                  _row('Destination', draft.destination.name),
                  _row('Coordinates',
                      '${draft.destination.latitude.toStringAsFixed(5)}, ${draft.destination.longitude.toStringAsFixed(5)}'),
                  if (draft.destinationContact?.isNotEmpty == true)
                    _row('Destination contact', draft.destinationContact!),
                  if (draft.routeRestriction?.isNotEmpty == true)
                    _row('Route restriction', draft.routeRestriction!),
                  if (draft.notes?.isNotEmpty == true) _row('Notes', draft.notes!),
                  _row('Origin',
                      '${state.latitude.toStringAsFixed(5)}, ${state.longitude.toStringAsFixed(5)}'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'On confirm, your live GPS stream and this request are shared with the traffic control center. No patient information is transmitted.',
            style: theme.textTheme.bodySmall?.copyWith(color: Colors.white38),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              backgroundColor: theme.colorScheme.error,
            ),
            icon: const Icon(Icons.emergency),
            label: const Text(
              'Confirm and request route',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            onPressed: () => Navigator.of(context).pushReplacementNamed(
              '/processing',
              arguments: draft,
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            icon: const Icon(Icons.edit_outlined),
            label: const Text('Edit details'),
            onPressed: () => Navigator.of(context).pop(),
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: () => Navigator.of(context).pushNamedAndRemoveUntil(
              '/home',
              (r) => false,
            ),
            child: const Text('Cancel', style: TextStyle(color: Colors.white54)),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => ListTile(
        dense: true,
        title: Text(label, style: const TextStyle(fontSize: 13, color: Colors.white54)),
        trailing: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 220),
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          ),
        ),
      );
}
