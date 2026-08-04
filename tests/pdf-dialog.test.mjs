import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../app/pdf-import-dialog.tsx',import.meta.url),'utf8');
test('PDF dialog restores sources and keeps selection order',()=>{assert.match(source,/projects\/\$\{project\.id\}\/sources/);assert.match(source,/const order=docs\.length\+next\+\+/);assert.doesNotMatch(source,/localeCompare/)});
test('PDF review is page-at-a-time with complete actions',()=>{assert.match(source,/current=active\?\.pages\?\.find/);for(const label of ['Повторить OCR','Встроенный текст','Сохранить и подтвердить','Исключить','Оригинал','TXT','JSON','Удалить'])assert.ok(source.includes(label),label)});
test('cancellation targets the selected document job and progress is real',()=>{assert.match(source,/const job=active\.job/);assert.match(source,/d\.job\?\.progress/);assert.doesNotMatch(source,/jobs\.find/)});
test('OCR retry is queued and separately cancellable',()=>{assert.match(source,/setOcrJob/);assert.match(source,/jobs\/\$\{ocrJob\.id\}\/cancel/)});
