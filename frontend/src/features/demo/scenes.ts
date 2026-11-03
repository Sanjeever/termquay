export type DemoScene = 'connections' | 'terminal' | 'editor';
export const demoScenes: { id: DemoScene; label: string }[] = [
  { id: 'connections', label: '演示：连接中心' },
  { id: 'terminal', label: '演示：SSH 工作区' },
  { id: 'editor', label: '演示：文件编辑' },
];
