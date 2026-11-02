import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import App from './App';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HeroUIProvider disableAnimation><App /></HeroUIProvider>,
);
