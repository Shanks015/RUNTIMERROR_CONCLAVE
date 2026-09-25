import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';

/// Recently used destinations, stored on-device only (no patient data,
/// no server sync — spec privacy rules).
class Recents {
  static const _key = 'recent_destinations';
  static const _max = 5;

  static Future<List<Destination>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null) return [];
      final list = jsonDecode(raw) as List;
      return list
          .map((x) => Destination.fromJson(x as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> push(Destination dest) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final current = await load();
      current.removeWhere((d) => d.name == dest.name);
      current.insert(0, dest);
      final trimmed = current.take(_max).toList();
      await prefs.setString(
        _key,
        jsonEncode(trimmed.map((d) => d.toJson()).toList()),
      );
    } catch (_) {
      // A prefs failure must never block an emergency trip.
    }
  }
}
