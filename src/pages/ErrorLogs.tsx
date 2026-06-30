import { useState, useEffect } from 'react';
import type { ErrorLog } from '../types';
import { format } from 'date-fns';
import { authFetch } from '../lib/api';

export default function ErrorLogs() {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await authFetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const markResolved = async (id: number) => {
    try {
      await authFetch(`/api/logs/${id}/resolve`, {
        method: 'PUT'
      });
      fetchLogs();
    } catch (e) {
      console.error(e);
    }
  };

  const getLevelBadge = (level: number) => {
    switch (level) {
      case 1: return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-bold uppercase">Bilgi</span>;
      case 2: return <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-bold uppercase">Uyarı</span>;
      case 3: return <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-[10px] font-bold uppercase">Hata</span>;
      case 4: return <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-[10px] font-bold uppercase">Kritik</span>;
      default: return <span className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-[10px] font-bold uppercase">Bilinmiyor</span>;
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-end">
        <button onClick={fetchLogs} className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm">
          Yenile
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Tarih</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Seviye</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Firma</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Kaynak</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Mesaj</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Durum</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">Yükleniyor...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">Log bulunamadı.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.Id} className={`hover:bg-slate-50 transition-colors ${log.IsResolved ? 'opacity-50' : ''}`}>
                    <td className="px-6 py-4 text-sm text-slate-600 whitespace-nowrap">
                      <div className="text-xs font-medium">{format(new Date(log.Timestamp), 'dd.MM.yyyy')}</div>
                      <div className="text-[10px] text-slate-400">{format(new Date(log.Timestamp), 'HH:mm:ss')}</div>
                    </td>
                    <td className="px-6 py-4">
                      {getLevelBadge(log.Level)}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">{log.CompanyName || '-'}</td>
                    <td className="px-6 py-4 font-mono text-[10px] text-slate-500">{log.Source}</td>
                    <td className="px-6 py-4 text-sm text-slate-900">
                      <div className="max-w-md truncate font-mono text-xs" title={log.Message}>{log.Message}</div>
                    </td>
                    <td className="px-6 py-4">
                      {log.IsResolved ? (
                        <span className="text-emerald-600 text-[10px] font-bold uppercase">Çözüldü</span>
                      ) : (
                        <span className="text-amber-600 text-[10px] font-bold uppercase">Bekliyor</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!log.IsResolved && (
                        <button 
                          onClick={() => markResolved(log.Id)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
