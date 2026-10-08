import { Check, Menu } from 'lucide-react';
import type { ViewPreference } from '../hooks/use-view-mode';

export function ViewMenu({ preference, onChoose, mobile, controlsOpen, onControls }: {
  preference: ViewPreference; onChoose: (value: ViewPreference) => void;
  mobile: boolean; controlsOpen: boolean; onControls: () => void;
}) {
  return <details className="view-menu">
    <summary aria-label="应用菜单"><Menu size={18}/><span>菜单</span></summary>
    <div className="view-menu-panel" role="menu" aria-label="应用菜单选项">
      <span>界面布局</span>
      {(['auto', 'mobile', 'desktop'] as const).map((value, index) => <button key={value}
        role="menuitemradio" aria-checked={preference === value}
        onClick={event => { onChoose(value); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
        {['自动适配', '手机版', '电脑版'][index]}{preference === value && <Check size={16}/>}
      </button>)}
      {mobile && <button role="menuitem" onClick={event => {
        onControls(); event.currentTarget.closest('details')?.removeAttribute('open');
      }}>{controlsOpen ? '收起工作簿与运行设置' : '工作簿与运行设置'}</button>}
    </div>
  </details>;
}
