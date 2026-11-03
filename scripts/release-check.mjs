import {readFileSync} from 'node:fs';

const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
const marker = '## 发行前待办';
const index = notices.indexOf(marker);
if (index < 0) throw new Error('缺少第三方依赖发行审计入口');
const pending = notices.slice(index + marker.length).trim();
if (pending) {
  console.error(`发行审计尚有未完成事项，拒绝公开 Release：\n${pending}`);
  process.exitCode = 1;
} else console.log('发行前待办已清空。');
