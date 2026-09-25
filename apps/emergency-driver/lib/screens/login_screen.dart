import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController(text: 'driver_104');
  final _password = TextEditingController(text: 'password');
  final _org = TextEditingController();
  final _server = TextEditingController();
  bool _showServer = false;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _server.text = context.read<AppState>().api.baseUrl;
  }

  Future<void> _submit() async {
    final state = context.read<AppState>();
    FocusScope.of(context).unfocus();
    if (_showServer && _server.text.trim().isNotEmpty) {
      await state.api.setServerUrl(_server.text.trim());
    }
    final ok = await state.login(
      _username.text.trim(),
      _password.text,
      _org.text.trim(),
    );
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Welcome, ${state.user?.name ?? 'driver'}')),
      );
      Navigator.of(context).pushNamedAndRemoveUntil('/home', (r) => false);
    }
  }

  void _contactAdmin() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Contact administrator'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Your organization administrator can create or reactivate driver accounts.'),
            SizedBox(height: 12),
            Text('Control center: +91 80 4567 8900', style: TextStyle(fontWeight: FontWeight.w700)),
            Text('Hours: 24x7 dispatch line'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
        ],
      ),
    );
  }

  void _forgotPassword() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset password'),
        content: const Text(
          'Passwords are managed by your organization. Contact your administrator '
          'or the control center to reset it — for your safety, passwords cannot '
          'be reset from the app itself.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              _contactAdmin();
            },
            child: const Text('Contact admin'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(Icons.local_hospital, size: 56, color: theme.colorScheme.error),
                const SizedBox(height: 12),
                Text(
                  'ResQConnect',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.0,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Emergency vehicle driver · authorized access only',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall?.copyWith(color: Colors.white54),
                ),
                const SizedBox(height: 28),
                TextField(
                  controller: _username,
                  decoration: const InputDecoration(
                    labelText: 'Username',
                    prefixIcon: Icon(Icons.person_outline),
                    border: OutlineInputBorder(),
                  ),
                  autocorrect: false,
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _password,
                  obscureText: _obscure,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_outline),
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _org,
                  decoration: const InputDecoration(
                    labelText: 'Organization ID (optional)',
                    prefixIcon: Icon(Icons.business_outlined),
                    border: OutlineInputBorder(),
                  ),
                  autocorrect: false,
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    TextButton.icon(
                      onPressed: _forgotPassword,
                      icon: const Icon(Icons.key_outlined, size: 18),
                      label: const Text('Forgot password'),
                    ),
                    TextButton.icon(
                      onPressed: _contactAdmin,
                      icon: const Icon(Icons.support_agent, size: 18),
                      label: const Text('Contact administrator'),
                    ),
                  ],
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => setState(() => _showServer = !_showServer),
                    icon: Icon(_showServer ? Icons.expand_less : Icons.settings_ethernet, size: 18),
                    label: const Text('Server address'),
                  ),
                ),
                if (_showServer)
                  TextField(
                    controller: _server,
                    decoration: const InputDecoration(
                      labelText: 'Backend URL',
                      hintText: 'http://192.168.x.x:8010',
                      prefixIcon: Icon(Icons.dns_outlined),
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.url,
                  ),
                const SizedBox(height: 22),
                if (state.authError != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      state.authError!,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ),
                FilledButton(
                  onPressed: state.busy ? null : _submit,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                  child: state.busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Log in'),
                ),
                const SizedBox(height: 20),
                Text(
                  'Demo: driver_104 / password',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall?.copyWith(color: Colors.white38),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
