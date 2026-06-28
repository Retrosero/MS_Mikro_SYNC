import { useState, useEffect } from 'react';
import type { ApiKey, Company } from '../types';
import { format, addYears } from 'date-fns';

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    CompanyId: '',
    Name: '',
    ExpiryDate: format(addYears(new Date(), 1), 'yyyy-MM-dd')
  });

  useEffect(() => {
    fetchKeys();
    fetchCompanies();
  }, []);

  const fetchKeys = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await fetch('/api/apikeys', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data);
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
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setIsModalOpen(false);
        setFormData({ ...formData, Name: '', CompanyId: '' }); // Reset
        fetchKeys();
      } else {
        const err = await res.json();
        alert('Hata: ' + (err.error || 'API Anahtarı oluşturulamadı'));
      }
    } catch (error) {
      alert('Sunucu bağlantı hatası');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (id: number, currentStatus: number) => {
    const newStatus = currentStatus === 1 ? 0 : 1; 
    try {
      const token = localStorage.getItem('adminToken');
      await fetch(`/api/apikeys/${id}/status`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ Status: newStatus })
      });
      fetchKeys();
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
          Yeni API Anahtarı
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Anahtar Adı</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Anahtar</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Firma</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Son Kullanım</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Durum</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">Yükleniyor...</td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">API Anahtarı bulunamadı.</td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.Id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">{k.Name}</td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">
                        {k.Key.substring(0, 16)}...
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{k.CompanyName}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      <div className="text-xs font-medium">
                        {k.ExpiryDate ? format(new Date(k.ExpiryDate), 'dd.MM.yyyy') : 'Süresiz'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                        k.Status === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {k.Status === 1 ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => toggleStatus(k.Id, k.Status)}
                        className={`text-xs font-semibold ${k.Status === 1 ? 'text-red-500 hover:text-red-700' : 'text-blue-600 hover:text-blue-800'}`}
                      >
                        {k.Status === 1 ? 'Suspend' : 'Reactivate'}
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
              <h3 className="text-lg font-semibold text-slate-800">Yeni API Anahtarı</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto">
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
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Anahtar Adı</label>
                <input required type="text" value={formData.Name} onChange={e => setFormData({...formData, Name: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500 text-sm" placeholder="Örn: Muhasebe Entegrasyonu" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Son Kullanım Tarihi</label>
                <input type="date" value={formData.ExpiryDate} onChange={e => setFormData({...formData, ExpiryDate: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500 text-sm" />
                <p className="text-[10px] text-slate-500 mt-1">Boş bırakılırsa süresiz olur.</p>
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
