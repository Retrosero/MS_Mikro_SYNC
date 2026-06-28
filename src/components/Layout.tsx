import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Building2, 
  KeyRound, 
  ShieldAlert, 
  LogOut,
  Settings2
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  onLogout: () => void;
}

export default function Layout({ children, onLogout }: LayoutProps) {
  const location = useLocation();

  const getTitle = () => {
    switch (location.pathname) {
      case '/': return 'Sistem Özeti';
      case '/companies': return 'Şirketler';
      case '/licenses': return 'Lisanslar';
      case '/apikeys': return 'API Anahtarları';
      case '/logs': return 'Hata Logları';
      default: return 'Yönetim Paneli';
    }
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/companies', icon: Building2, label: 'Şirketler' },
    { to: '/licenses', icon: KeyRound, label: 'Lisanslar' },
    { to: '/apikeys', icon: Settings2, label: 'API Anahtarları' },
    { to: '/logs', icon: ShieldAlert, label: 'Hata Logları' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 flex flex-col shrink-0 hidden md:flex">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center">
              <span className="text-white font-bold text-lg leading-none">M</span>
            </div>
            <span className="text-white font-bold text-xl tracking-tight">Mikro<span className="text-blue-400">Sync</span></span>
          </div>
        </div>
        
        <nav className="flex-1 py-6 px-0 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 transition-colors ${
                  isActive
                    ? 'bg-blue-600/10 text-blue-400 border-r-4 border-blue-400 font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto p-6 bg-slate-950/50 border-t border-slate-800">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs text-slate-400 font-mono">SERVER_ONLINE</span>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center w-full px-3 py-2 text-sm font-medium rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <LogOut className="w-4 h-4 mr-2 flex-shrink-0" />
            Çıkış Yap
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <h1 className="text-xl font-semibold text-slate-800">{getTitle()}</h1>
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 bg-slate-200 rounded-full flex items-center justify-center border border-slate-300">
              <span className="text-xs font-bold text-slate-600">AD</span>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          <div className="p-8 flex flex-col gap-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
