import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { editorLanguage } from './editorLanguage.ts';

for (const [path, content] of [['/tmp/test.sh', '#!/bin/sh\necho "$PATH"'], ['/home/test/.bashrc', 'export A=1'], ['/tmp/config.ini', '[server]\nport=22'], ['/tmp/config.toml', '[server]\nport=22'], ['/etc/nginx/sites-enabled/default', 'server { listen 80; }'], ['/tmp/script', '#!/usr/bin/env python3\nprint("test")'], ['/tmp/main.go','package main\nfunc main() {}'], ['/tmp/Makefile','all:\n\techo test'], ['/tmp/Dockerfile','FROM alpine\nRUN echo test'], ['/tmp/test.cmd','@echo off\nset VALUE=test']]) {
  test(`使用语言包高亮 ${path}`, async () => {
    const state = EditorState.create({ doc: content, extensions: [await editorLanguage(path,content)] });
    assert.ok(syntaxTree(state).topNode.firstChild);
  });
}
