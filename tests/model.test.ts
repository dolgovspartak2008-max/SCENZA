import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterProjects, formatTime, validateVideo, resolveProject, projects } from '../src/model.ts';

test('поиск учитывает регистр, пробелы и пустой результат', () => {
  assert.equal(filterProjects('  ТИХИЙ  ')[0]?.id, 'tihiy-gorod');
  assert.equal(filterProjects('несуществующий фильм').length, 0);
  assert.equal(filterProjects(' ').length, projects.length);
});

test('выбор файла отклоняет неверный тип, пустой и слишком большой файл', () => {
  assert.equal(validateVideo({ name: 'clip.mp4', type: 'video/mp4', size: 1024 }), null);
  assert.equal(validateVideo({ name: 'clip.MOV', type: '', size: 1024 }), null);
  assert.ok(validateVideo({ name: 'photo.png', type: 'image/png', size: 1024 }));
  assert.ok(validateVideo({ name: 'empty.mp4', type: 'video/mp4', size: 0 }));
  assert.ok(validateVideo({ name: 'big.mp4', type: 'video/mp4', size: 3 * 1024 ** 3 }));
});

test('время и маршруты корректно обрабатывают границы', () => {
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(-1), '00:00');
  assert.equal(resolveProject('/projects/za-gorizontom')?.title, 'За горизонтом');
  assert.equal(resolveProject('/projects/unknown'), undefined);
});
