const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const localModelPorts = new Set(['1234', '11434']);

/** Only LM Studio and Ollama's well-known loopback ports qualify as local model endpoints. */
export function isLocalModelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && loopbackHosts.has(url.hostname) && localModelPorts.has(url.port) &&
      !url.username && !url.password && !url.search && !url.hash && /^\/[a-zA-Z0-9/_-]*$/.test(url.pathname);
  } catch {
    return false;
  }
}
