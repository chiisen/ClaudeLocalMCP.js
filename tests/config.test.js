import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import dotenv from 'dotenv';

test('設定載入支援預設路徑、等號路徑與環境變數優先權', async t => {
    const { loadConfig } = await import('../config.js');
    const directory = mkdtempSync(join(tmpdir(), 'weather-config-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const envPath = join(directory, 'weather=dev.env');
    writeFileSync(envPath, 'OPENWEATHERMAP_API_KEY=file-key\n');
    assert.equal(loadConfig([`envPath=${envPath}`], {}).apiKey, 'file-key');
    assert.equal(loadConfig([`envPath=${envPath}`], { OPENWEATHERMAP_API_KEY: 'system-key' }).apiKey, 'system-key');
    assert.throws(() => loadConfig(['envPath='], {}), /envPath/);
    assert.throws(() => loadConfig([`envPath=${join(directory, 'missing.env')}`], {}), /Unable to load/);
    assert.throws(() => loadConfig([`envPath=${join(directory, 'missing.env')}`], { OPENWEATHERMAP_API_KEY: 'key' }), /Unable to load/);
    writeFileSync(envPath, 'OPENWEATHERMAP_API_KEY=\n');
    assert.throws(() => loadConfig([`envPath=${envPath}`], {}), /Missing API key/);

    // 隔離使用者的真實 .env，驗證預設路徑與無檔案時的環境變數行為。
    const config = t.mock.method(dotenv, 'config', options => {
        assert.equal(options.path, fileURLToPath(new URL('../.env', import.meta.url)));
        return { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) };
    });
    assert.equal(loadConfig([], { OPENWEATHERMAP_API_KEY: ' system-key ' }).apiKey, 'system-key');
    assert.throws(() => loadConfig([], {}), /Missing API key/);
    config.mock.restore();
});
