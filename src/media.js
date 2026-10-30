export function mediaURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com') || url.username || url.password) throw new Error('Unexpected media host.');
  return url;
}

export async function fetchMedia(value, signal) {
  let url = mediaURL(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    // Ask the CDN for a text redirect so each request keeps the page's CORS origin.
    url.searchParams.set('alr', 'yes');
    const response = await fetch(url, { credentials: 'omit', signal });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'text/plain') return response;
    if (redirects === 3) { await response.body?.cancel(); throw new Error('Too many media server redirects. Retry the VR source.'); }
    if (!response.body) throw new Error('The media server returned an empty redirect.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 16384) throw new Error('The media server redirect exceeded the size limit.');
        chunks.push(value);
      }
    } finally { reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const next = mediaURL(new TextDecoder().decode(bytes).trim());
    next.searchParams.set('range', url.searchParams.get('range'));
    url = next;
  }
}
