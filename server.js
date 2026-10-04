import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';
import { loadConfig } from './config.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function textResult(data, isError = false) {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        ...(isError ? { isError: true } : {}),
    };
}

export function createServer({ apiKey, requestTimeoutMs = 10000 } = loadConfig()) {
    if (!apiKey?.trim()) {
        throw new Error('Server configuration error: Missing API key. Set OPENWEATHERMAP_API_KEY.');
    }
    const server = new McpServer({ name: 'Real Weather MCP Server', version });
    server.tool('get_weather', 'Get current weather for a city. Chinese city names are automatically translated to English.', {
        city: z.string().trim().min(1, 'city name is required.').describe('City name in English or Chinese'),
    }, async ({ city }, { signal }) => {
        const options = { timeout: requestTimeoutMs, signal };
        try {
            signal.throwIfAborted();
            // 只翻譯含漢字的城市；英文及其他拼音名稱直接交給天氣服務。
            if (/\p{Script=Han}/u.test(city)) {
                try {
                    const response = await axios.get('https://api.mymemory.translated.net/get', {
                        ...options, params: { q: city, langpair: 'zh-TW|en' },
                    });
                    const translated = response.data?.responseData?.translatedText;
                    if (Number(response.data?.responseStatus) === 200 && typeof translated === 'string' && translated.trim()) {
                        city = translated.trim();
                    } else {
                        console.warn('Translation unavailable. Using original city name.');
                    }
                } catch (error) {
                    if (signal.aborted || axios.isCancel(error)) throw error;
                    console.warn('Translation request failed. Using original city name.');
                }
            }
            // 翻譯結束後若已取消，不再發送天氣請求。
            signal.throwIfAborted();
            const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
                ...options,
                params: { q: city, appid: apiKey.trim(), units: 'metric', lang: 'zh_tw' },
            });
            if (response.status !== 200 || Number(response.data?.cod) !== 200) {
                return textResult({ error: response.data?.message || `Could not find weather data for ${city}.` }, true);
            }
            const data = response.data;
            return textResult({
                city: data.name,
                temperature: data.main.temp,
                condition: data.weather[0]?.description || 'N/A',
                humidity: data.main.humidity,
                wind_speed: data.wind.speed,
                country: data.sys.country,
            });
        } catch (error) {
            let message = `Failed to fetch weather data for ${city}.`;
            if (signal.aborted || axios.isCancel(error)) {
                message = 'Weather request cancelled.';
            } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                message = 'Weather service request timed out. Please try again.';
            } else if (axios.isAxiosError(error) && error.response) {
                const status = error.response.status;
                message = `Error from weather service (HTTP ${status}).`;
                if (status === 404) message = `Could not find the city: ${city}`;
                if (status === 401) message = 'Invalid API key or unauthorized request.';
            }
            // 不輸出 Axios error/config，避免把 URL、金鑰或上游內容寫進日誌。
            return textResult({ error: message }, true);
        }
    });
    return server;
}
