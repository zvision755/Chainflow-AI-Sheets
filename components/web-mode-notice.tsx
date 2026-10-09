import {browserPersistence} from '../core/deployment';
export function WebModeNotice(){return browserPersistence?<p className="local-mode-notice" role="note">Chainflow Web · 工作簿、配置与记忆密钥仅存于此浏览器 IndexedDB，请定期导出 JSON。清理站点数据会丢失工作簿；浏览器密钥可被此设备用户及扩展读取。AI 直连需提供商允许跨域；原生朗读可用，火山免配置 TTS 与本地 Codex 不提供。</p>:null;}
