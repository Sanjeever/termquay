import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileIconKind } from './fileIcons.ts';

const icon=(name:string,extra={})=>fileIconKind({name,directory:false,symlink:false,mode:'-rw-r--r--',...extra});
test('按名称优先识别配置、容器、包清单和源码文件',()=>{
  for(const [name,kind] of [['Dockerfile.dev','docker'],['docker-compose.yml','docker'],['go.mod','go'],['Cargo.toml','rust'],['package.json','package'],['.env.production','config'],['.gitignore','git'],['main.tsx','react'],['main.PY','python'],['a.tar.gz','archive'],['notes.md','markdown']])assert.equal(icon(name),kind,name);
});
test('目录用途、符号链接与未知类型保持可辨识',()=>{
  assert.equal(icon('.ssh',{directory:true}),'folder-secure');
  assert.equal(icon('.config',{directory:true}),'folder-config');
  assert.equal(icon('source',{directory:true}),'folder-code');
  assert.equal(icon('unknown',{directory:true}),'folder');
  assert.equal(icon('file.py',{symlink:true}),'link');
  assert.equal(icon('run',{mode:'-rwxr-xr-x'}),'executable');
  assert.equal(icon('unknown.custom'),'file');
});
