import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

// @ts-ignore
import {
  repairMineruCacheImages,
  prepareMineruCacheForReparse,
  finishMineruCacheReparse,
} from '../electron/backend/mineruCacheCommands.cjs';

async function createCacheFixture(options: {
  images: string[];
  contentList: unknown;
}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-cache-repair-'));

  await fsp.mkdir(path.join(directory, 'images'), { recursive: true });
  for (const name of options.images) {
    await fsp.writeFile(path.join(directory, 'images', name), 'fake-image');
  }
  await fsp.writeFile(
    path.join(directory, 'content_list_v2.json'),
    JSON.stringify(options.contentList, null, 2),
    'utf8',
  );

  return directory;
}

test('repairMineruCacheImages rewrites missing refs to the unique part_N_ file', async () => {
  const directory = await createCacheFixture({
    images: ['part_1_aaa.jpg', 'part_2_bbb.jpg'],
    // 页字典形状（MinerU v2 / 拆分合并产物）
    contentList: [
      {
        0: { type: 'image', content: { image_source: { path: 'images/aaa.jpg' } } },
        1: { type: 'image', content: { image_source: { path: 'images/bbb.jpg' } } },
      },
    ],
  });

  try {
    const report = await repairMineruCacheImages({ directory });

    assert.equal(report.fixed, 2);
    assert.equal(report.unresolved, 0);
    assert.deepEqual(report.changedFiles, ['content_list_v2.json']);

    const repaired = JSON.parse(
      await fsp.readFile(path.join(directory, 'content_list_v2.json'), 'utf8'),
    );

    // 形状保持：仍是页字典
    assert.equal(Array.isArray(repaired), true);
    assert.equal(repaired[0]['0'].content.image_source.path, 'images/part_1_aaa.jpg');
    assert.equal(repaired[0]['1'].content.image_source.path, 'images/part_2_bbb.jpg');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('repairMineruCacheImages is idempotent and leaves correct refs untouched', async () => {
  const directory = await createCacheFixture({
    images: ['part_1_aaa.jpg', 'present.jpg'],
    contentList: [
      {
        0: { type: 'image', content: { image_source: { path: 'images/part_1_aaa.jpg' } } },
        1: { type: 'image', content: { image_source: { path: 'images/present.jpg' } } },
        2: { type: 'image', img_path: 'images/aaa.jpg' },
      },
    ],
  });

  try {
    const first = await repairMineruCacheImages({ directory });
    assert.equal(first.scannedRefs, 3);
    assert.equal(first.fixed, 1);
    assert.equal(first.unresolved, 0);

    const second = await repairMineruCacheImages({ directory });
    assert.equal(second.fixed, 0);
    assert.deepEqual(second.changedFiles, []);
    // 第二次调用命中进程内记忆化：不再重复解析 JSON，也不重复上报修复条数
    assert.equal(second.memoized, true);
    assert.equal(second.unresolved, 0);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('repairMineruCacheImages refuses to guess when several candidates exist', async () => {
  // 两个分卷都产出了同名图片：改写会让引用指向错误的那一张，必须保持原样。
  const directory = await createCacheFixture({
    images: ['part_1_dup.jpg', 'part_2_dup.jpg'],
    contentList: [{ 0: { type: 'image', content: { image_source: { path: 'images/dup.jpg' } } } }],
  });

  try {
    const report = await repairMineruCacheImages({ directory });

    assert.equal(report.fixed, 0);
    assert.equal(report.unresolved, 1);
    assert.deepEqual(report.unresolvedSamples, ['images/dup.jpg']);

    const untouched = JSON.parse(
      await fsp.readFile(path.join(directory, 'content_list_v2.json'), 'utf8'),
    );
    assert.equal(untouched[0]['0'].content.image_source.path, 'images/dup.jpg');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('repairMineruCacheImages ignores non-asset strings and remote or absolute paths', async () => {
  const directory = await createCacheFixture({
    images: ['part_1_aaa.jpg'],
    contentList: [
      {
        0: {
          type: 'paragraph',
          content: { paragraph_content: [{ type: 'text', content: 'see images/aaa.jpg in text' }] },
        },
        1: { type: 'image', content: { image_source: { path: 'https://example.com/a.jpg' } } },
        2: { type: 'image', content: { image_source: { path: 'C:\\abs\\a.jpg' } } },
      },
    ],
  });

  try {
    const report = await repairMineruCacheImages({ directory });

    assert.equal(report.fixed, 0);
    assert.equal(report.unresolved, 0);
    // 正文里的同名字符串与远程/绝对路径都不算结构性资源引用
    assert.equal(report.scannedRefs, 2);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('prepareMineruCacheForReparse backs up derived caches and clears parse outputs', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-reparse-'));

  try {
    await fsp.mkdir(path.join(directory, 'images'), { recursive: true });
    await fsp.mkdir(path.join(directory, 'translations'), { recursive: true });
    await fsp.mkdir(path.join(directory, 'summaries'), { recursive: true });
    await fsp.mkdir(path.join(directory, 'translations.bak-1'), { recursive: true });

    await fsp.writeFile(path.join(directory, 'content_list_v2.json'), '[]', 'utf8');
    await fsp.writeFile(path.join(directory, 'full.md'), '# doc', 'utf8');
    await fsp.writeFile(path.join(directory, 'middle.json'), '{}', 'utf8');
    await fsp.writeFile(path.join(directory, 'images', 'a.jpg'), 'image', 'utf8');
    await fsp.writeFile(path.join(directory, 'translations', 'zh.json'), '{}', 'utf8');
    await fsp.writeFile(path.join(directory, 'summaries', 'x.json'), '{}', 'utf8');
    await fsp.writeFile(path.join(directory, 'paper_reader_manifest.json'), '{}', 'utf8');

    const result = await prepareMineruCacheForReparse({ directory });

    // 解析产物被清除
    assert.deepEqual(result.removedFiles.sort(), ['content_list_v2.json', 'full.md', 'middle.json']);
    // 上一代备份被清理，避免无限堆积
    assert.deepEqual(result.removedStaleBackups, ['translations.bak-1']);
    // 译文 / 摘要 / 图片被备份而不是删除
    assert.deepEqual(result.backups.map((item: { name: string }) => item.name).sort(), [
      'images',
      'summaries',
      'translations',
    ]);

    assert.equal(await fsp.stat(path.join(directory, 'translations')).catch(() => null), null);
    const manifestStillThere = await fsp
      .stat(path.join(directory, 'paper_reader_manifest.json'))
      .catch(() => null);
    assert.ok(manifestStillThere, 'manifest should survive so pdfPath stays resolvable');

    const backups = result.backups as Array<{ name: string; backupName: string }>;
    const translationBackup = backups.find((item) => item.name === 'translations');
    assert.ok(translationBackup);
    assert.ok(
      await fsp.stat(path.join(directory, translationBackup.backupName, 'zh.json')),
      'backup must keep the previous translations',
    );

    await finishMineruCacheReparse({ directory, success: true });
    for (const backup of backups) {
      assert.equal(
        await fsp.stat(path.join(directory, backup.backupName)).catch(() => null),
        null,
        'successful re-parse should drop the backup generation',
      );
    }
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('finishMineruCacheReparse keeps backups when the re-parse failed', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-reparse-fail-'));

  try {
    await fsp.mkdir(path.join(directory, 'translations'), { recursive: true });
    await fsp.writeFile(path.join(directory, 'translations', 'zh.json'), '{}', 'utf8');

    const result = await prepareMineruCacheForReparse({ directory });
    const backupName = result.backups[0].backupName;

    const finished = await finishMineruCacheReparse({ directory, success: false });

    assert.deepEqual(finished.removed, []);
    assert.ok(await fsp.stat(path.join(directory, backupName)), 'failed re-parse must keep the backup');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});
