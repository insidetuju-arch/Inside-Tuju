import React, { useState } from 'react';
import { Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { UserAccount } from '../types/hc';
import { connectGoogleForGmail } from '../lib/firebaseAuth';
import { GoogleSignInButton } from './GoogleSignInButton';

interface LoginPortalProps {
  needsBootstrap: boolean;
  onAuthenticated: (token: string, user: UserAccount, gmailToken?: string) => void;
}

export const LoginPortal: React.FC<LoginPortalProps> = ({
  needsBootstrap,
  onAuthenticated,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // First-run admin claim fields
  const [fullName, setFullName] = useState('Pengelola Utama Kopi Tuju');
  const [email, setEmail] = useState('insidetuju@gmail.com');
  const [adminPassword, setAdminPassword] = useState('');
  const [createStarterAccounts, setCreateStarterAccounts] = useState(true);
  const [starterPassword, setStarterPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (adminPassword.length < 6) {
      setError('Password Admin minimal 6 karakter.');
      return;
    }
    if (createStarterAccounts && starterPassword.length < 6) {
      setError('Password awal untuk akun contoh HR Manager & Barista minimal 6 karakter.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          username: email,
          password: adminPassword,
          createStarterAccounts,
          starterPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mengaktifkan akun Admin.');
      }
      onAuthenticated(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal masuk.');
      }
      onAuthenticated(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await connectGoogleForGmail();
      const res = await fetch('/api/auth/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleAccessToken: accessToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal masuk dengan Google.');
      }
      onAuthenticated(data.token, data.user, accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk dengan Google.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7FB] flex flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        {/* Left Editorial Column */}
        <div className="lg:col-span-5 flex flex-col justify-between bg-[#0B4EA2] text-white p-8 rounded-xl border border-[#093E82]">
          <div>
            <div className="inline-flex items-center gap-3 bg-white px-3.5 py-2 rounded-lg">
              <img
                src="/assets/aistudio/BIRU__1__68671e1f.png"
                alt="Logo Toko Kopi Tuju"
                referrerPolicy="no-referrer"
                className="h-6 w-auto object-contain"
              />
              <span className="text-xs font-bold text-[#0B4EA2] whitespace-nowrap">
                Makassar
              </span>
            </div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
              Portal Human Capital, Onboarding & Payroll
            </h1>
            <p className="mt-3 text-sm text-blue-100 leading-relaxed">
              Pusat kendali terpadu untuk Pengelola HC, Admin Sistem, dan Kru Barista di seluruh
              cabang Kopi Tuju (Abdesir, Agus Salim, Djemma, Holding, Perintis, dan Tamalate).
            </p>
          </div>

          <div className="mt-10 pt-6 border-t border-white/15 space-y-4 text-xs text-blue-50">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-blue-200 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white">Akses Berbasis Peran</p>
                <p className="text-blue-100/90 mt-0.5">
                  Admin mengontrol sistem, Manager HC mengelola database, training 14 hari &amp;
                  payroll, dan Kru melihat slip gaji serta progres pribadinya.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <UserCheck className="w-4 h-4 text-blue-200 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white">Slip Gaji PDF &amp; Kirim Gmail Otomatis</p>
                <p className="text-blue-100/90 mt-0.5">
                  Unduh slip gaji resmi dan kirim langsung ke email masing-masing kru barista
                  yang terdaftar.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Form Column */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-center">
          {needsBootstrap ? (
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0B4EA2]">
                <Lock className="w-4 h-4" />
                <span>Aktivasi Awal Portal HC</span>
              </div>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">
                Klaim Akun Admin Utama
              </h2>
              <p className="mt-1.5 text-sm text-slate-600">
                Belum ada password Admin yang tersimpan. Buat akun Admin pertama untuk mengunci
                portal, atau langsung masuk menggunakan akun Google pengelola.
              </p>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleBootstrap} className="mt-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Nama Pengelola / Admin
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/20 focus:border-[#0B4EA2]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Email Admin
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/20 focus:border-[#0B4EA2]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Password Admin Baru (min. 6 karakter)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Masukkan password Admin"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/20 focus:border-[#0B4EA2]"
                  />
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createStarterAccounts}
                      onChange={(e) => setCreateStarterAccounts(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-[#0B4EA2] focus:ring-[#0B4EA2]"
                    />
                    <span className="text-xs text-slate-700 leading-relaxed">
                      Sekaligus buat akun awal untuk <strong className="font-semibold">HR Manager</strong>{' '}
                      (<span className="font-mono">hc.kopituju</span>) dan contoh{' '}
                      <strong className="font-semibold">Kru Barista</strong> (
                      <span className="font-mono">affan.barista</span>) untuk uji peran.
                    </span>
                  </label>

                  {createStarterAccounts && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Password Awal Akun HR Manager &amp; Barista
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={starterPassword}
                        onChange={(e) => setStarterPassword(e.target.value)}
                        placeholder="Password awal akun HR & Kru"
                        className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/20 focus:border-[#0B4EA2]"
                      />
                    </div>
                  )}
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="h-10 px-5 text-sm font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
                  >
                    {loading ? 'Menyimpan...' : 'Aktifkan Portal & Masuk'}
                  </button>
                  <span className="text-xs text-slate-400">atau</span>
                  <GoogleSignInButton
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    label="Masuk dengan Google"
                  />
                </div>
              </form>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium text-slate-500">
                Pengelola HC · Admin Sistem · Kru &amp; Staf
              </p>
              <h2 className="mt-1.5 text-2xl font-bold text-slate-900">
                Masuk ke Portal Kopi Tuju
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Gunakan akun yang telah didaftarkan oleh Pengelola atau masuk dengan Google.
              </p>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handlePasswordLogin} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Username atau Email Terdaftar
                  </label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="contoh: hc.kopituju atau affan.barista"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/20 focus:border-[#0B4EA2]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan password"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/20 focus:border-[#0B4EA2]"
                  />
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="h-10 px-6 text-sm font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
                  >
                    {loading ? 'Memverifikasi...' : 'Masuk ke Portal'}
                  </button>
                  <span className="text-xs text-slate-400">atau</span>
                  <GoogleSignInButton
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    label="Sign in with Google"
                  />
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
