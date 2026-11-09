import { t } from '../../i18n/index.ts';
export type DemoScene = 'connections' | 'terminal' | 'editor';
export const demoScenes: { id: DemoScene; label: string }[] = [
  { id: 'connections', get label() { return t('demo:sceneConnections'); } },
  { id: 'terminal', get label() { return t('demo:sceneTerminal'); } },
  { id: 'editor', get label() { return t('demo:sceneEditor'); } },
];
