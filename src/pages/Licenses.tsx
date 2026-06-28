import { useState, useEffect } from 'react';
import type { License, Company } from '../types';
import { format, addYears } from 'date-fns';

export default function Licenses() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    CompanyId: '',
    Type: 2,
    StartDate: format(new Date(), 'yyyy-MM-dd'),
    ExpiryDate: format(addYears(new Date(), 1), 'yyyy-MM-dd'),
    MaxUsers: 5,
    MaxDevices: 10,
    EnableOfflineMode: 0,
    EnableSync: 1
  });

  useEffect(() => {
    fetchLicenses();
    fetchCompanies();
  }, []);

  const fetchLicenses = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await fetch('/api/licenses', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLicenses(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await fetch('/api/companies', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCompanies(data);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const token = localStorage.getItem('adminToken');
      const res = await fetch('/api/licenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setIsModalOpen(false);
        setFormData({ ...formData, CompanyId: '' }); // Reset
        fetchLicenses();
      } else {
        const err = await res.json();
        alert('Hata: ' + (err.error || 'Lisans oluşturulamadı'));
      }
    } catch (error) {
      alert('Sunucu bağlantı hatası');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 1: return <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase">Aktif</span>;
      case 2: return <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-bold uppercase">Süresi Dolmuş</span>;
      case 3: return <span className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-[10px] font-bold uppercase">Askıya Alınmış</span>;
      default: return <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-[10px] font-bold uppercase">Pasif</span>;
    }
  };

  const toggleStatus = async (id: number, currentStatus: number) => {
    const newStatus = currentStatus === 1 ? 3 : 1; // Toggle active/suspended
    try {
      const token = localStorage.getItem('adminToken');
      await fetch(`/api/licenses/${id}/status`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ Status: newStatus })
      });
      fetchLicenses();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-end">
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-all"
        >
          Yeni Lisans Üret
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Lisans Anahtarı</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Firma</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Bitiş Tarihi</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Kapasite</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Durum</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">Yükleniyor...</td>
                </tr>
              ) : licenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">Lisans bulunamadı.</td>
                </tr>
              ) : (
                licenses.map((license) => (
                  <tr key={license.Id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-800">
                      {license.LicenseKey}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">{license.CompanyName}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      <div className="text-xs font-medium">{format(new Date(license.ExpiryDate), 'dd.MM.yyyy')}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      <div className="text-xs font-medium">{license.MaxUsers} Kullanıcı</div>
                      <div className="text-[10px] text-slate-400">{license.MaxDevices} Cihaz</div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(license.Status)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => toggleStatus(license.Id, license.Status)}
                        className={`text-xs font-semibold ${license.Status === 1 ? 'text-red-500 hover:text-red-700' : 'text-blue-600 hover:text-blue-800'}`}
                      >
                        {license.Status === 1 ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Yeni Lisans Üret</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[80vh]">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Şirket</label>
                <select 
                  required 
                  value={formData.CompanyId} 
                  onChange={e => setFormData({...formData, CompanyId: e.target.value})} 
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500 text-sm"
                >
                  <option value="" disabled>Şirket Seçin...</option>
                  {companies.map(c => (
                    <option key={c.Id} value={c.Id}>{c.Name} ({c.Code})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Başlangıç Tarihi</label>
                  <input required type="date" value={formData.StartDate} onChange={e => setFormData({...formData, StartDate: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Bitiş Tarihi</label>
                  <input required type="date" value={formData.ExpiryDate} onChange={e => setFormData({...formData, ExpiryDate: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Max Kullanıcı</label>
                  <input required type="number" min="1" value={formData.MaxUsers} onChange={e => setFormData({...formData, MaxUsers: parseInt(e.target.value) || 1})} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Max Cihaz</label>
                  <input required type="number" min="1" value={formData.MaxDevices} onChange={e => setFormData({...formData, MaxDevices: parseInt(e.target.value) || 1})} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500 text-sm" />
                </div>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.EnableSync === 1} onChange={e => setFormData({...formData, EnableSync: e.target.checked ? 1 : 0})} className="rounded text-blue-600" />
                  <span className="text-sm font-medium text-slate-700">Senkronizasyon Aktif</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.EnableOfflineMode === 1} onChange={e => setFormData({...formData, EnableOfflineMode: e.target.checked ? 1 : 0})} className="rounded text-blue-600" />
                  <span className="text-sm font-medium text-slate-700">Çevrimdışı Mod Aktif</span>
                </label>
              </div>
              
              <div className="mt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">İptal</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                  {submitting ? 'Oluşturuluyor...' : 'Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
