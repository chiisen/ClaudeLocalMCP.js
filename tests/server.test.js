import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import axios from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../server.js';

const weather = {
    status: 200,
    data: { cod: 200, name: 'Taichung', main: { temp: 26, humidity: 70 },
        weather: [{ description: '晴' }], wind: { speed: 2 }, sys: { country: 'TW' } },
};
const translation = { data: { responseStatus: 200, responseData: { translatedText: 'Taichung' } } };
const payload = result => JSON.parse(result.content[0].text);

async function connect(t, options = {}) {
    const server = createServer({ apiKey: 'test-key', ...options });
    const client = new Client({ name: 'regression-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(() => client.close());
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
}

test('MCP 握手版本與套件一致，工具可被列出', async t => {
    const client = await connect(t);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
    assert.equal(client.getServerVersion().version, pkg.version);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['get_weather']);
});

test('英文城市去除首尾空白且只查詢天氣，保留既有回傳欄位', async t => {
    const calls = [];
    t.mock.method(axios, 'get', async (url, options) => {
        calls.push({ url, options });
        return url.includes('translated.net') ? translation : weather;
    });
    const client = await connect(t);
    const result = await client.callTool({ name: 'get_weather', arguments: { city: ' Taichung ' } });
    assert.deepEqual(payload(result), { city: 'Taichung', temperature: 26, condition: '晴',
        humidity: 70, wind_speed: 2, country: 'TW' });
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    const params = new URLSearchParams(calls[0].options?.params ?? url.search);
    assert.equal(params.get('q'), 'Taichung');
    assert.equal(params.get('units'), 'metric');
    assert.equal(params.get('lang'), 'zh_tw');
    assert.equal(params.get('appid'), 'test-key');
    assert.equal(calls[0].options.timeout, 10000);
    assert.ok(calls[0].options.signal instanceof AbortSignal);
});

for (const city of ['', '   ', 123]) {
    test(`無效城市 ${JSON.stringify(city)} 在發送 HTTP 前拒絕`, async t => {
        let calls = 0;
        t.mock.method(axios, 'get', async () => { calls++; return translation; });
        const client = await connect(t);
        await assert.rejects(client.callTool({ name: 'get_weather', arguments: { city } }), /Invalid arguments/);
        assert.equal(calls, 0);
    });
}

test('缺少金鑰在建立 Server 時立即失敗', () => {
    assert.throws(() => createServer({ apiKey: '  ' }), /Missing API key/);
});

test('中文城市翻譯後查詢，兩個階段均受逾時及取消控制', async t => {
    const calls = [];
    t.mock.method(axios, 'get', async (url, options) => {
        calls.push({ url, options });
        return url.includes('translated.net') ? translation : weather;
    });
    const client = await connect(t);
    const result = await client.callTool({ name: 'get_weather', arguments: { city: '台中' } });
    assert.equal(payload(result).city, 'Taichung');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.params.q, '台中');
    assert.equal(calls[0].options.params.langpair, 'zh-TW|en');
    assert.equal(calls[1].options.params.q, 'Taichung');
    for (const call of calls) {
        assert.equal(call.options.timeout, 10000);
        assert.ok(call.options.signal instanceof AbortSignal);
    }
});

for (const failure of ['network', 'timeout', 'blank', 'quota']) {
    test(`翻譯 ${failure} 時使用原城市繼續查詢`, async t => {
        let query;
        t.mock.method(axios, 'get', async (url, options) => {
            if (url.includes('translated.net')) {
                if (failure === 'network') throw new Error('offline');
                if (failure === 'timeout') throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
                if (failure === 'quota') return { data: { responseStatus: 429, responseData: { translatedText: 'QUOTA EXCEEDED' } } };
                return { data: { responseStatus: 200, responseData: { translatedText: '   ' } } };
            }
            query = options?.params?.q ?? new URL(url).searchParams.get('q');
            return weather;
        });
        const client = await connect(t);
        const result = await client.callTool({ name: 'get_weather', arguments: { city: '台中' } });
        assert.equal(payload(result).temperature, 26);
        assert.equal(query, '台中');
    });
}

for (const [status, message] of [[401, /Invalid API key/], [404, /Could not find the city/], [500, /weather service/]]) {
    test(`天氣 HTTP ${status} 回傳 MCP 錯誤`, async t => {
        t.mock.method(axios, 'get', async () => {
            throw new axios.AxiosError('failed', undefined, undefined, undefined,
                { status, data: { message: 'upstream failure' } });
        });
        const client = await connect(t);
        const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Taichung' } });
        assert.equal(result.isError, true);
        assert.match(payload(result).error, message);
    });
}

test('HTTP 200 內含業務錯誤時也標示 isError', async t => {
    t.mock.method(axios, 'get', async () => ({ status: 200, data: { cod: '404', message: 'city not found' } }));
    const client = await connect(t);
    const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Unknown' } });
    assert.equal(result.isError, true);
    assert.match(payload(result).error, /city not found/);
});

test('實際 HTTP 停滯會逾時並回傳錯誤', { timeout: 3000 }, async t => {
    const httpServer = createHttpServer(() => {});
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    t.after(() => { httpServer.closeAllConnections(); httpServer.close(); });
    const get = axios.get.bind(axios);
    t.mock.method(axios, 'get', (url, options) => get(`http://127.0.0.1:${httpServer.address().port}`, options));
    const client = await connect(t, { requestTimeoutMs: 40 });
    const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Taichung' } });
    assert.equal(result.isError, true);
    assert.match(payload(result).error, /timed out/i);
});

for (const city of ['台中', 'Taichung']) {
    test(`取消 ${city} 請求會中止 HTTP，且不進入後續階段`, { timeout: 2000 }, async t => {
        let started;
        let aborted;
        const start = new Promise(resolve => { started = resolve; });
        const abort = new Promise(resolve => { aborted = resolve; });
        let calls = 0;
        t.mock.method(axios, 'get', (url, options) => new Promise((resolve, reject) => {
            calls++;
            options?.signal?.addEventListener('abort', () => {
                aborted();
                reject(new axios.CanceledError());
            }, { once: true });
            started();
        }));
        const client = await connect(t);
        const controller = new AbortController();
        const pending = client.callTool({ name: 'get_weather', arguments: { city } }, undefined, { signal: controller.signal });
        const rejected = assert.rejects(pending);
        await start;
        controller.abort();
        await rejected;
        await abort;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls, 1);
    });
}
