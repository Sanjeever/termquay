import i18n from '../i18n/index.ts';
await i18n.changeLanguage('zh-CN');
import{test}from'vitest';import{strict as assert}from'node:assert';import{snippetParameters,expandSnippet}from'./snippets.ts';
test('参数按名字去重并保持原始文本和换行',()=>{assert.deepEqual(snippetParameters('echo {{name}} {{name}} {{other}}'),['name','other']);assert.deepEqual(expandSnippet('echo {{name}}\n',{name:'a; b'}),{text:'echo a; b\n',error:''});assert.equal(expandSnippet('echo hello',{}).text,'echo hello');});
test('缺失参数和扩展大小明确拒绝',()=>{assert.match(expandSnippet('{{missing}}',{}).error,/缺少参数/);assert.match(expandSnippet('{{x}}'.repeat(1000),{x:'a'.repeat(1024)}).error,/超过/);});
