import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onAuthed();
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onAuthed();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#070B14] overflow-hidden">
      {/* Subtle ambient light — deep blue only, no green */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#1E3A8A]/20 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-[#1E40AF]/10 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[400px] mx-4"
      >
        {/* Logo mark — clean geometric, no gradient blob */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative w-14 h-14 mb-5">
            {/* Outer rounded square */}
            <div className="absolute inset-0 rounded-[18px] bg-[#0B1220] border border-[#1E3A8A]/40 shadow-[0_8px_32px_rgba(30,58,138,0.35)]" />
            {/* Inner signal dots */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3px]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#1E40AF]" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#1E3A8A]" />
            </div>
          </div>
          <h1 className="text-[22px] font-semibold text-white tracking-[-0.02em] text-center">
            Traffic Command Center
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1.5 text-center">
            Bangalore Emergency Response Network
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#0B1220]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] p-6">
          {/* Tab switch — subtle, minimal */}
          <div className="flex gap-1 p-1 bg-[#070B14] rounded-xl mb-6 border border-white/[0.04]">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-[#1E3A8A]/30 text-white shadow-sm'
                  : 'text-[#64748B] hover:text-[#94A3B8]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${
                mode === 'signup'
                  ? 'bg-[#1E3A8A]/30 text-white shadow-sm'
                  : 'text-[#64748B] hover:text-[#94A3B8]'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-medium text-[#64748B] mb-1.5 block uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@traffic.gov.in"
                className="w-full px-4 py-3 bg-[#070B14] border border-white/[0.06] rounded-xl text-white placeholder-[#334155] text-[14px] focus:outline-none focus:border-[#3B82F6]/60 focus:bg-[#070B14] transition-all"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#64748B] mb-1.5 block uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-[#070B14] border border-white/[0.06] rounded-xl text-white placeholder-[#334155] text-[14px] focus:outline-none focus:border-[#3B82F6]/60 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#7F1D1D]/20 border border-[#DC2626]/30 rounded-xl text-[#FCA5A5] text-[12px]">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium text-[14px] rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(37,99,235,0.3)]"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? 'Enter Command Center' : 'Create Account'}
            </button>
          </form>

          <p className="text-[11px] text-[#475569] text-center mt-5">
            Demo authentication · No email confirmation required
          </p>
        </div>
      </motion.div>
    </div>
  );
}