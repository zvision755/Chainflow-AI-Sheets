import React from 'react';
import { AppSettings, ProviderType } from '../types';
import { X, Settings, Server, Cpu } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [localSettings, setLocalSettings] = React.useState<AppSettings>(settings);

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleChange = (key: keyof AppSettings, value: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Model Configuration
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Provider Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Active Provider</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleChange('provider', ProviderType.GEMINI)}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  localSettings.provider === ProviderType.GEMINI
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Server className="w-4 h-4" />
                Gemini AI
              </button>
              <button
                onClick={() => handleChange('provider', ProviderType.LOCAL)}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  localSettings.provider === ProviderType.LOCAL
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Cpu className="w-4 h-4" />
                Local LLM
              </button>
            </div>
          </div>

          {/* Configuration Fields */}
          {localSettings.provider === ProviderType.GEMINI ? (
            <div className="space-y-4 animate-fade-in">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gemini Model</label>
                <select
                  value={localSettings.geminiModelName}
                  onChange={(e) => handleChange('geminiModelName', e.target.value)}
                  className="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fast)</option>
                  <option value="gemini-3-pro-preview">Gemini 3 Pro Preview (High Quality)</option>
                  <option value="gemini-2.5-flash-thinking">Gemini 2.5 Flash Thinking</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  API Key is managed via environment variables securely.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 animate-fade-in">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="text"
                  value={localSettings.localBaseUrl}
                  onChange={(e) => handleChange('localBaseUrl', e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
                <input
                  type="text"
                  value={localSettings.localModelName}
                  onChange={(e) => handleChange('localModelName', e.target.value)}
                  placeholder="llama3, mistral, etc."
                  className="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                <p className="text-xs text-yellow-700">
                  Note: Ensure your local server allows CORS (e.g., <code>OLLAMA_ORIGINS="*"</code>).
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              localSettings.provider === ProviderType.GEMINI
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};