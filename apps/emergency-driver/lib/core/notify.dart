import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Local notifications for urgent control-center events (route changed,
/// incident, GPS/network lost, trip status). Sound + vibration, never
/// full-screen takeover — the driver keeps looking at the road.
class Notify {
  static final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static Future<void> init() async {
    if (_ready) return;
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );
    try {
      await _plugin.initialize(settings: settings);
      final android =
          _plugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      await android?.requestNotificationsPermission();
      _ready = true;
    } catch (_) {
      // Notifications are an enhancement; never block the app on them.
      _ready = false;
    }
  }

  static Future<void> urgent(String title, String body) =>
      _show(title, body, importance: Importance.high, vibrate: true);

  static Future<void> info(String title, String body) =>
      _show(title, body, importance: Importance.defaultImportance, vibrate: false);

  static Future<void> _show(
    String title,
    String body, {
    required Importance importance,
    required bool vibrate,
  }) async {
    if (!_ready) return;
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        vibrate ? 'resq_urgent' : 'resq_info',
        vibrate ? 'Urgent trip updates' : 'Trip updates',
        channelDescription:
            'Route, incident and trip status notifications from the control center',
        importance: importance,
        priority: vibrate ? Priority.high : Priority.defaultPriority,
        enableVibration: vibrate,
        vibrationPattern: vibrate
            ? Int64List.fromList([0, 250, 140, 250, 140, 250])
            : null,
        color: const Color(0xFFC62828),
        styleInformation: BigTextStyleInformation(body),
      ),
    );
    try {
      await _plugin.show(
        id: DateTime.now().millisecondsSinceEpoch ~/ 1000,
        title: title,
        body: body,
        notificationDetails: details,
      );
    } catch (_) {
      // Best effort — a denied notification permission must not break the trip.
    }
  }
}
