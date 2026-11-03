import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { MotionConfig, useReducedMotion } from 'framer-motion';
import App from './App';
import { AppearanceProvider } from './features/settings/AppearanceProvider';
import './style.css';
import appIcon from '../../build/appicon.svg';
import { System } from '@wailsio/runtime';

const favicon = document.createElement('link');
favicon.rel = 'icon'; favicon.type = 'image/svg+xml'; favicon.href = appIcon;
document.head.appendChild(favicon);
document.documentElement.dataset.platform = System.IsMac() ? 'mac' : 'other';

function WorkbenchApp() {
  const reducedMotion = useReducedMotion();
  return <MotionConfig reducedMotion="user" transition={{ duration: .16, ease: [.2, .8, .2, 1] }}><AppearanceProvider><HeroUIProvider locale="zh-CN" disableAnimation={!!reducedMotion} disableRipple><App /></HeroUIProvider></AppearanceProvider></MotionConfig>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<WorkbenchApp />);
