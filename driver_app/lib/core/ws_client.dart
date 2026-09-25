import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'config.dart';

/// Live feed from the control centre for one trip.
/// Reconnects with backoff; surfaces every message as a stream event.
class TripSocket {
  TripSocket({required this.baseUrl, required this.tripId, required this.token});

  final String baseUrl;
  final String tripId;
  final String token;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;
  Timer? _pingTimer;
  bool _closedByUser = false;
  int _attempt = 0;

  final _controller = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get messages => _controller.stream;

  bool get isConnected => _channel != null;

  void connect() {
    _closedByUser = false;
    _open();
  }

  void _open() {
    final wsBase = baseUrl.replaceFirst(RegExp(r'^http'), 'ws');
    final uri = Uri.parse('$wsBase${AppConfig.wsPath}/$tripId?token=$token');
    try {
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      _attempt = 0;

      _sub = channel.stream.listen(
        (raw) {
          try {
            final data = jsonDecode(raw as String);
            if (data is Map<String, dynamic>) {
              if (data['type'] != 'pong') _controller.add(data);
            }
          } catch (_) {
            // Ignore malformed frames; the feed keeps running.
          }
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );

      _pingTimer?.cancel();
      _pingTimer = Timer.periodic(const Duration(seconds: 20), (_) {
        try {
          channel.sink.add('ping');
        } catch (_) {
          _scheduleReconnect();
        }
      });

      _controller.add({
        'type': 'connection',
        'connected': true,
        'message': 'Connected to control center.',
      });
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _sub?.cancel();
    _sub = null;
    _pingTimer?.cancel();
    _channel = null;
    if (_closedByUser) return;

    _controller.add({
      'type': 'connection',
      'connected': false,
      'message': 'Control center link lost. Retrying...',
    });

    _attempt++;
    final delay = Duration(
      seconds: (AppConfig.wsReconnectDelay.inSeconds * (1 << (_attempt - 1).clamp(0, 4)))
          .clamp(3, 30),
    );
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () {
      if (!_closedByUser) _open();
    });
  }

  void close() {
    _closedByUser = true;
    _reconnectTimer?.cancel();
    _pingTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _channel = null;
    _controller.close();
  }
}
