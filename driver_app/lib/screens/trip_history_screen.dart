import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';

class TripHistoryScreen extends StatelessWidget {
  const TripHistoryScreen({super.key});

  String _fmt(DateTime t) {
    final local = t.toLocal();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)} ${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();

    // Kick off the first load on build; loadHistory guards against double-fetch.
    if (state.history.isEmpty && !state.historyLoading) {
      WidgetsBinding.instance.addPostFrameCallback((_) => state.loadHistory());
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Trip history')),
      body: state.historyLoading && state.history.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.history.isEmpty
              ? const Center(
                  child: Text('No trips yet.', style: TextStyle(color: Colors.white54)),
                )
              : RefreshIndicator(
                  onRefresh: state.loadHistory,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: state.history.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final t = state.history[i];
                      final reason = t.completionStatus;
                      return Card(
                        margin: EdgeInsets.zero,
                        child: ListTile(
                          leading: Icon(
                            t.status == 'completed'
                                ? Icons.check_circle_outline
                                : t.status == 'cancelled'
                                    ? Icons.cancel_outlined
                                    : Icons.directions,
                            color: t.status == 'completed'
                                ? Colors.greenAccent
                                : t.status == 'cancelled'
                                    ? Colors.redAccent
                                    : Colors.amber,
                          ),
                          title: Text(
                            t.destinationName,
                            style: const TextStyle(
                                fontSize: 15, fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(
                            '${t.tripId}\n'
                            '${emergencyTypes[t.emergencyType] ?? t.emergencyType} · '
                            '${priorityLevels[t.priority] ?? t.priority}\n'
                            'Started ${_fmt(t.startedAt)}'
                            '${t.completedAt != null ? ' → ${_fmt(t.completedAt!)}' : ''}',
                            style: const TextStyle(fontSize: 12.5, height: 1.35),
                          ),
                          isThreeLine: true,
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                t.status.replaceAll('_', ' '),
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: t.status == 'completed'
                                      ? Colors.greenAccent
                                      : t.status == 'cancelled'
                                          ? Colors.redAccent
                                          : Colors.amber,
                                ),
                              ),
                              if (reason != null && reason != t.status)
                                Text(
                                  endTripReasons[reason] ?? reason,
                                  style: const TextStyle(
                                      fontSize: 11, color: Colors.white54),
                                ),
                            ],
                          ),
                          onTap: () => showDialog<void>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: Text(t.tripId,
                                  style: const TextStyle(fontSize: 16)),
                              content: Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Destination: ${t.destinationName}'),
                                  Text('Vehicle: ${t.vehicleId}'),
                                  Text(
                                    'Type: ${emergencyTypes[t.emergencyType] ?? t.emergencyType}',
                                  ),
                                  Text('Priority: ${priorityLevels[t.priority] ?? t.priority}'),
                                  Text('Status: ${t.status.replaceAll('_', ' ')}'),
                                  if (t.completionStatus != null)
                                    Text(
                                      'End reason: ${endTripReasons[t.completionStatus] ?? t.completionStatus}',
                                    ),
                                  Text('Started: ${_fmt(t.startedAt)}'),
                                  if (t.completedAt != null)
                                    Text('Completed: ${_fmt(t.completedAt!)}'),
                                ],
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(ctx),
                                  child: const Text('Close'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
