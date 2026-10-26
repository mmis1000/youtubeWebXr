import { InitCollector, isInitStart } from './metadata.js';

export function observeMedia(onChange) {
  const sources = new WeakMap(), buffers = new WeakMap(), urls = new Map();
  const create = URL.createObjectURL;
  URL.createObjectURL = function (object) {
    const url = Reflect.apply(create, this, arguments);
    if (object instanceof MediaSource) {
      if (!sources.has(object)) sources.set(object, { metadata: null, error: null, revision: 0 });
      urls.set(url, sources.get(object));
    }
    return url;
  };
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = function (url) {
    // Browsers can keep playing revoked object URLs; retain only a bounded set of associations.
    if (urls.size > 32) urls.delete(urls.keys().next().value);
    return Reflect.apply(revoke, this, arguments);
  };
  const add = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime) {
    const buffer = Reflect.apply(add, this, arguments);
    if (/^video\//i.test(mime)) {
      if (!sources.has(this)) sources.set(this, { metadata: null, error: null, revision: 0 });
      buffers.set(buffer, { source: sources.get(this), collector: new InitCollector() });
    }
    return buffer;
  };
  const append = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (data) {
    const result = Reflect.apply(append, this, arguments);
    const state = buffers.get(this);
    if (state) {
      try {
        const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
        if (isInitStart(bytes)) {
          state.source.metadata = null; state.source.error = null; state.source.revision++;
          onChange(state.source);
        }
        const metadata = state.collector.push(bytes);
        if (metadata) {
          state.source.metadata = metadata; state.source.revision++;
          onChange(state.source);
        }
      } catch (error) {
        state.collector.done = true; state.source.error = error.message; state.source.revision++;
        onChange(state.source);
      }
    }
    return result;
  };
  return video => video && (urls.get(video.currentSrc || video.src) || sources.get(video.srcObject));
}
