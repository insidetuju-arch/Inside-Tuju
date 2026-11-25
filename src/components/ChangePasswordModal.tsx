import React, { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { UserAccount } from '../types/hc';

interface ChangePasswordModalProps {
  currentUser: UserAccount;
  authToken: string;
  onClose: () => void;
  onPasswordUpdated: (updatedUser: UserAccount) => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  currentUser,
  authToken,
  onClose,
  onPasswordUpdated,
}) => {
  const requiresCurrentPassword = currentUser.hasPassword !== false;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (requiresCurrentPassword && !currentPassword) {
      setError('Password saat ini wajib diisi.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password baru minimal 6 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Konfirmasi password baru tidak cocok.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/me/password', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          currentPassword: requiresCurrentPassword ? currentPassword : '',
          newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Gagal memperbarui password.');
        return;
      }
      if (data.user) {
        onPasswordUpdated(data.user as UserAccount);
      }
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('Terjadi kesalahan jaringan saat memperbarui password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 no-print">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#0B4EA2]" />
            <h3 className="text-sm font-bold text-slate-900">Ubah Password Akun</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
            aria-label="Tutup modal ubah password"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-lg">
            <p className="font-semibold text-slate-900">{currentUser.fullName}</p>
            <p className="text-slate-500 mt-0.5">
              {currentUser.role} · <span className="font-mono">{currentUser.username}</span>
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 font-medium">
              {error}
            </div>
          )}

          {success ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Password akun Anda berhasil diperbarui.</span>
              </div>
              <p className="text-[11px] text-emerald-800">
                Gunakan password baru tersebut saat login berikutnya ke Portal HC Toko Kopi Tuju.
              </p>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg"
                >
                  Selesai
                </button>
              </div>
            </div>
          ) : (
            <>
              {requiresCurrentPassword ? (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Password Saat Ini
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrent ? 'text' : 'password'}
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Masukkan password saat ini"
                      autoComplete="current-password"
                      className="w-full h-9 px-3 pr-9 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/25 focus:border-[#0B4EA2]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-900">
                  Akun Anda login via Google dan belum memiliki password lokal. Buat password baru
                  agar dapat masuk menggunakan username/email.
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password Baru (min. 6 karakter)
                </label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Masukkan password baru"
                    autoComplete="new-password"
                    className="w-full h-9 px-3 pr-9 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/25 focus:border-[#0B4EA2]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Konfirmasi Password Baru
                </label>
                <input
                  type={showNew ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi password baru"
                  autoComplete="new-password"
                  className="w-full h-9 px-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/25 focus:border-[#0B4EA2]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-4 font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] disabled:opacity-60 rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Password'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
