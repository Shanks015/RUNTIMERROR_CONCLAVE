import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';

/// Screen 1: brand splash while the app pings backend health, then routes
/// to login or the authenticated home. Timeout never traps the driver here.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  String _phase = 'Starting ResQConnect...';

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    final state = context.read<AppState>();
    await state.init();

    setState(() => _phase = 'Checking control center connection...');
    final healthy = await _healthCheck(state.api.baseUrl, timeout: const Duration(seconds: 5));

    if (!mounted) return;
    if (!healthy) {
      state.messages.add({
        'text': 'Control center unreachable. You can still log in if the address is wrong.',
        'kind': 'warn',
      });
    }

    // Small deliberate hold so the splash reads as branding, not a flash.
    await Future<void>.delayed(const Duration(milliseconds: 700));
    if (!mounted) return;

    if (state.loggedIn && state.activeTripId != null) {
      final resumed = await state.resumeTrip(state.activeTripId!);
      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed(resumed ? '/active-trip' : '/home');
    } else if (state.loggedIn) {
      Navigator.of(context).pushReplacementNamed('/home');
    } else {
      Navigator.of(context).pushReplacementNamed('/login');
    }
  }

  Future<bool> _healthCheck(String baseUrl, {required Duration timeout}) async {
    try {
      final client = HttpClient()..connectionTimeout = timeout;
      final req = await client.getUrl(Uri.parse('$baseUrl/api/health'));
      final resp = await req.close().timeout(timeout);
      await resp.drain<void>();
      client.close(force: true);
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: theme.colorScheme.error.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.emergency, size: 64, color: theme.colorScheme.error),
            ),
            const SizedBox(height: 20),
            Text(
              'ResQConnect',
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Green corridor driver link',
              style: theme.textTheme.bodyMedium?.copyWith(color: Colors.white54),
            ),
            const SizedBox(height: 34),
            const SizedBox(
              height: 22,
              width: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4),
            ),
            const SizedBox(height: 14),
            Text(
              _phase,
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.white38),
            ),
          ],
        ),
      ),
    );
  }
}
