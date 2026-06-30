import { useEffect, useState } from 'react';
import { Building2, KeyRound, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { DashboardStats } from '../types';
import { authFetch } from '../lib/api';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await authFetch('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch stats");
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { label: 'Toplam Şirket', value: stats?.totalCompanies || 0, icon: Building2, color: 'bg-blue-500' },
    { label: 'Toplam Lisans', value: stats?.totalLicenses || 0, icon: KeyRound, color: 'bg-purple-500' },
    { label: 'Aktif Lisans', value: stats?.activeLicenses || 0, icon: CheckCircle2, color: 'bg-emerald-500' },
    { label: 'Çözülmemiş Hata', value: stats?.recentErrors || 0, icon: ShieldAlert, color: 'bg-rose-500' },
  ];

  if (loading) {
    return <div className="flex h-full items-center justify-center">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
        {statCards.map((stat, idx) => (
          <div key={idx} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">{stat.label}</p>
            <p className="text-2xl font-bold mt-1 text-slate-900">{stat.value}</p>
            <div className="mt-2 flex items-center gap-1 text-emerald-600">
              <stat.icon className="w-3 h-3" />
              <span className="text-xs font-semibold">Aktif</span>
            </div>
          </div>
        ))}
      </div>
      
      {/* You can add charts or more detailed tables here in the future */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex-1">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Sistem Durumu</h2>
        <p className="text-slate-600 text-sm">Sistem sorunsuz çalışıyor. Lisans ve API anahtarı takibi için sol menüyü kullanabilirsiniz.</p>
      </div>
    </div>
  );
}
