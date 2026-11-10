import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { MotionConfig, useReducedMotion } from 'framer-motion';
import App from './App';
import { AppearanceProvider } from './features/settings/AppearanceProvider';
import './style.css';
import appIcon from '../../build/appicon.svg';
import { System } from '@wailsio/runtime';
import './i18n';
import { useTranslation } from 'react-i18next';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = appIcon;
document.head.appendChild(favicon);
document.documentElement.dataset.platform = System.IsMac() ? 'mac' : 'other';

function WorkbenchApp() {
  const reducedMotion = useReducedMotion();
  const { i18n } = useTranslation();
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}>
      <AppearanceProvider>
        <HeroUIProvider
          locale={i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en-US'}
          disableAnimation={!!reducedMotion}
          disableRipple
        >
          <App />
        </HeroUIProvider>
      </AppearanceProvider>
    </MotionConfig>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<WorkbenchApp />);
