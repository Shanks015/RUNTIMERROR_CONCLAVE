import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/models.dart';
import 'config.dart';
import 'token_store.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;

  @override
  String toString() => message;
}

/// Thin HTTP client for the emergency-driver API.
/// Handles token refresh (one retry on 401) and JSON plumbing.
class ApiClient {
  ApiClient({TokenStore? store}) : _store = store ?? TokenStore();

  final TokenStore _store;
  String _baseUrl = AppConfig.defaultBaseUrl;
  Future<void> Function()? onSessionExpired;

  String get baseUrl => _baseUrl;

  Future<void> init() async {
    final saved = await _store.serverUrl();
    if (saved != null && saved.isNotEmpty) _baseUrl = saved;
  }

  Future<void> setServerUrl(String url) async {
    _baseUrl = url.replaceAll(RegExp(r'/+$'), '');
    await _store.saveServerUrl(_baseUrl);
  }

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  Map<String, String> _headers({String? token, bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool auth = true,
    bool retryOn401 = true,
  }) async {
    final token = auth ? await _store.accessToken() : null;
    final req = http.Request(method, _uri(path));
    req.headers.addAll(_headers(token: token));
    if (body != null) req.body = jsonEncode(body);

    final streamed = await req.send().timeout(const Duration(seconds: 20));
    final resp = await http.Response.fromStream(streamed);

    if (resp.statusCode == 401 && auth && retryOn401) {
      final refreshed = await _tryRefresh();
      if (refreshed) {
        return _request(method, path, body: body, auth: auth, retryOn401: false);
      }
      await _store.clear();
      onSessionExpired?.call();
      throw ApiException(401, 'Session expired. Please log in again.');
    }

    return _decode(resp);
  }

  dynamic _decode(http.Response resp) {
    dynamic data;
    try {
      data = resp.body.isEmpty ? null : jsonDecode(resp.body);
    } catch (_) {
      data = null;
    }
    if (resp.statusCode >= 400) {
      final detail = data is Map ? (data['detail'] ?? data['message']) : null;
      throw ApiException(
        resp.statusCode,
        detail?.toString() ?? 'Request failed (${resp.statusCode})',
      );
    }
    return data;
  }

  Future<bool> _tryRefresh() async {
    final refresh = await _store.refreshToken();
    if (refresh == null) return false;
    try {
      final req = http.Request('POST', _uri('/api/auth/refresh'));
      req.headers.addAll(_headers());
      req.body = jsonEncode({'refresh_token': refresh});
      final streamed = await req.send().timeout(const Duration(seconds: 10));
      final resp = await http.Response.fromStream(streamed);
      if (resp.statusCode != 200) return false;
      final data = jsonDecode(resp.body) as Map<String, dynamic>;
      await _store.saveTokens(
        accessToken: data['access_token'],
        refreshToken: data['refresh_token'],
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------- auth ----------

  Future<LoginResult> login({
    required String username,
    required String password,
    String? organizationId,
  }) async {
    final data = await _request(
      'POST',
      '/api/auth/login',
      body: {
        'username': username,
        'password': password,
        if (organizationId != null && organizationId.isNotEmpty)
          'organization_id': organizationId,
      },
      auth: false,
    ) as Map<String, dynamic>;
    await _store.saveTokens(
      accessToken: data['access_token'],
      refreshToken: data['refresh_token'],
    );
    return LoginResult.fromJson(data);
  }

  Future<void> logout() async {
    final refresh = await _store.refreshToken();
    try {
      await _request('POST', '/api/auth/logout',
          body: {'refresh_token': refresh}, auth: false);
    } catch (_) {
      // Best effort — local clear below is what matters for the device.
    }
    await _store.clear();
  }

  Future<bool> hasSession() async =>
      (await _store.accessToken()) != null;

  /// No sockets to tear down today; kept so callers have a symmetric lifecycle.
  void dispose() {}

  Future<LoginResult> me() async {
    final data = await _request('GET', '/api/auth/me') as Map<String, dynamic>;
    return LoginResult.fromJson(data);
  }

  // ---------- vehicles ----------

  Future<List<Vehicle>> vehicles() async {
    final data = await _request('GET', '/api/vehicles') as List;
    return data
        .map((v) => Vehicle.fromJson(v as Map<String, dynamic>))
        .toList();
  }

  // ---------- trips ----------

  Future<StartTripResult> startTrip({
    required String vehicleId,
    required String vehicleType,
    required String emergencyType,
    required String priority,
    required Destination destination,
    required GpsFix location,
    String? notes,
  }) async {
    final data = await _request(
      'POST',
      '/api/emergency-trips',
      body: {
        'vehicle_id': vehicleId,
        'vehicle_type': vehicleType,
        'emergency_type': emergencyType,
        'priority': priority,
        'destination': destination.toJson(),
        'location': location.toJson(),
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    ) as Map<String, dynamic>;
    return StartTripResult.fromJson(data);
  }

  Future<LocationAck> sendLocation(String tripId, GpsFix fix) async {
    final data = await _request(
      'POST',
      '/api/emergency-trips/$tripId/location',
      body: fix.toJson(),
    ) as Map<String, dynamic>;
    return LocationAck.fromJson(data);
  }

  Future<TripSnapshot> trip(String tripId) async {
    final data =
        await _request('GET', '/api/emergency-trips/$tripId') as Map<String, dynamic>;
    return TripSnapshot.fromJson(data);
  }

  Future<IncidentReport> reportIncident({
    required String tripId,
    required String type,
    required double latitude,
    required double longitude,
    String? description,
    String severity = 'medium',
    String? roadSegment,
  }) async {
    final data = await _request(
      'POST',
      '/api/emergency-trips/$tripId/incidents',
      body: {
        'type': type,
        'latitude': latitude,
        'longitude': longitude,
        if (description != null && description.isNotEmpty)
          'description': description,
        if (roadSegment != null && roadSegment.isNotEmpty)
          'road_segment': roadSegment,
        'severity': severity,
        'timestamp': DateTime.now().toUtc().toIso8601String(),
      },
    ) as Map<String, dynamic>;
    return IncidentReport.fromJson(data);
  }

  Future<TripSummary> completeTrip({
    required String tripId,
    required String completionStatus,
    required double latitude,
    required double longitude,
  }) async {
    final data = await _request(
      'POST',
      '/api/emergency-trips/$tripId/complete',
      body: {
        'completion_status': completionStatus,
        'final_latitude': latitude,
        'final_longitude': longitude,
        'timestamp': DateTime.now().toUtc().toIso8601String(),
      },
    ) as Map<String, dynamic>;
    return TripSummary.fromJson(data);
  }

  Future<RerouteResult> reroute({
    required String tripId,
    required String reason,
  }) async {
    final data = await _request(
      'POST',
      '/api/emergency-trips/$tripId/reroute',
      body: {'reason': reason},
    ) as Map<String, dynamic>;
    return RerouteResult.fromJson(data);
  }

  Future<List<HistoryTrip>> tripHistory() async {
    final data = await _request('GET', '/api/emergency-trips') as List;
    return data
        .map((t) => HistoryTrip.fromJson(t as Map<String, dynamic>))
        .toList();
  }
}
