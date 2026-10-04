import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

function fixture(t) {
    // 放在專案下以共用 node_modules，金鑰與設定完全使用測試檔案。
    const directory = mkdtempSync(fileURLToPath(new URL('./startup-', import.meta.url)));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    for (const file of ['index.js', 'server.js', 'config.js', 'package.json']) {
        copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
    }
    return directory;
}

for (const mode of ['default', 'explicit', 'environment', 'watch']) {
    test(`stdio ${mode} 啟動成功且 stdout 保持 MCP 格式`, { timeout: 10000 }, async t => {
        const directory = fixture(t);
        const envPath = join(directory, mode === 'explicit' ? 'weather=dev.env' : '.env');
        if (mode !== 'environment') writeFileSync(envPath, 'OPENWEATHERMAP_API_KEY=fixture-key\n');
        const args = [join(directory, 'index.js')];
        if (mode === 'explicit') args.push(`envPath=${envPath}`);
        if (mode === 'watch') args.unshift('--watch');
        const env = getDefaultEnvironment();
        if (mode === 'environment') env.OPENWEATHERMAP_API_KEY = 'environment-key';
        const transport = new StdioClientTransport({ command: process.execPath, args, env, cwd: tmpdir(), stderr: 'pipe' });
        const client = new Client({ name: 'startup-test', version: '1.0.0' });
        t.after(() => client.close());
        await client.connect(transport);
        const tools = await client.listTools();
        assert.equal(tools.tools[0].name, 'get_weather');
        await assert.rejects(client.callTool({ name: 'get_weather', arguments: { city: ' ' } }), /Invalid arguments/);
    });
}

test('缺少金鑰時程序退出並僅在 stderr 提供設定錯誤', t => {
    const directory = fixture(t);
    const result = spawnSync(process.execPath, [join(directory, 'index.js')], {
        env: getDefaultEnvironment(), cwd: tmpdir(), encoding: 'utf8', timeout: 5000, windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Missing API key/);
});
