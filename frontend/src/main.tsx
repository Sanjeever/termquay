import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import App from './App';
import { AppearanceProvider } from './features/settings/AppearanceProvider';
import './style.css';
import appIcon from '../../build/appicon.svg';

const favicon = document.createElement('link');
favicon.rel = 'icon'; favicon.type = 'image/svg+xml'; favicon.href = appIcon;
document.head.appendChild(favicon);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppearanceProvider><HeroUIProvider disableAnimation><App /></HeroUIProvider></AppearanceProvider>,
);
