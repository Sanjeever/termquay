import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { MotionConfig, useReducedMotion } from 'framer-motion';
import App from './App';
import { AppearanceProvider } from './features/settings/AppearanceProvider';
import './style.css';
import appIcon from '../../build/appicon.svg';

const favicon = document.createElement('link');
favicon.rel = 'icon'; favicon.type = 'image/svg+xml'; favicon.href = appIcon;
document.head.appendChild(favicon);

function WorkbenchApp() {
  const reducedMotion = useReducedMotion();
  return <MotionConfig reducedMotion="user"><AppearanceProvider><HeroUIProvider disableAnimation={!!reducedMotion}><App /></HeroUIProvider></AppearanceProvider></MotionConfig>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<WorkbenchApp />);
