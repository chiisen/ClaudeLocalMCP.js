import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export function loadConfig(args = process.argv.slice(2), env = process.env) {
    let envPath = fileURLToPath(new URL('./.env', import.meta.url));
    let explicitPath = false;
    for (const arg of args) {
        if (!arg.startsWith('envPath=') || !arg.slice('envPath='.length).trim()) {
            throw new Error('Server configuration error: Expected envPath=<path>.');
        }
        envPath = arg.slice('envPath='.length);
        explicitPath = true;
    }
    const result = dotenv.config({ path: envPath, processEnv: env });
    if (result.error && (explicitPath || result.error.code !== 'ENOENT')) {
        throw new Error(`Server configuration error: Unable to load envPath (${result.error.code || 'unknown error'}).`);
    }
    const apiKey = env.OPENWEATHERMAP_API_KEY?.trim();
    if (!apiKey) {
        throw new Error('Server configuration error: Missing API key. Set OPENWEATHERMAP_API_KEY.');
    }
    return { apiKey };
}
