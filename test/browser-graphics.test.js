import test from 'node:test';
import assert from 'node:assert/strict';
import { browserGraphicsGuide, classifyGraphicsRenderer, detectBrowserGraphics } from '../shared/browser-graphics.js';

test('graphics hints distinguish CPU renderers, real GPU names and masked information', () => {
  for (const renderer of ['ANGLE (Google, Vulkan SwiftShader Device)', 'Mesa llvmpipe (LLVM 15)', 'softpipe', 'lavapipe', 'Microsoft Basic Render Driver', 'Microsoft WARP', 'NVIDIA software adapter']) {
    assert.equal(classifyGraphicsRenderer(renderer), 'software', renderer);
  }
  for (const renderer of ['ANGLE (Intel, Intel UHD Graphics, D3D11)', 'NVIDIA GeForce RTX 4060', 'AMD Radeon RX 6600', 'Apple M2', 'Adreno (TM) 740', 'Mali-G78']) {
    assert.equal(classifyGraphicsRenderer(renderer), 'hardware', renderer);
  }
  for (const renderer of ['', null, 'WebKit WebGL', 'ANGLE', 'Mozilla', 'Unrecognized GPU']) assert.equal(classifyGraphicsRenderer(renderer), 'unknown');
});

function context(renderer) {
  let released = 0;
  const gl = {
    isContextLost: () => false,
    getParameter: () => renderer,
    getExtension: name => name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : { loseContext: () => released++ },
  };
  return { gl, released: () => released };
}

test('WebGL2 falls back to WebGL1 and releases its temporary context', () => {
  const fixture = context('ANGLE (Intel UHD Graphics)'), calls = [];
  assert.equal(detectBrowserGraphics(() => ({ getContext: type => { calls.push(type); return type === 'webgl' ? fixture.gl : null; } })), 'hardware');
  assert.deepEqual(calls, ['webgl2', 'webgl']);
  assert.equal(fixture.released(), 1);
});

test('software and unavailable contexts do not become claims about the browser switch', () => {
  const fixture = context('SwiftShader');
  assert.equal(detectBrowserGraphics(() => ({ getContext: () => fixture.gl })), 'software');
  assert.equal(fixture.released(), 1);
  assert.equal(detectBrowserGraphics(() => ({ getContext: () => null })), 'unavailable');
  assert.equal(detectBrowserGraphics(() => { throw new Error('Blocked'); }), 'unavailable');
});

test('privacy restrictions, lost contexts and probe failures remain unknown and release resources', () => {
  for (const failure of ['masked', 'exception', 'lost', 'parameter']) {
    const fixture = context('Intel UHD Graphics'), originalExtension = fixture.gl.getExtension;
    fixture.gl.getExtension = name => {
      if (name !== 'WEBGL_debug_renderer_info') return originalExtension(name);
      if (failure === 'exception') throw new Error('Blocked');
      return failure === 'masked' ? null : originalExtension(name);
    };
    if (failure === 'lost') fixture.gl.isContextLost = () => true;
    if (failure === 'parameter') fixture.gl.getParameter = () => { throw new Error('Blocked'); };
    assert.equal(detectBrowserGraphics(() => ({ getContext: () => fixture.gl })), 'unknown', failure);
    assert.equal(fixture.released(), 1, failure);
  }
});

test('settings guidance recognizes desktop Edge/Chrome and avoids desktop URLs on mobile or other browsers', () => {
  assert.equal(browserGraphicsGuide('Windows Chrome/140.0 Edg/140.0').address, 'edge://settings/system');
  assert.equal(browserGraphicsGuide('Macintosh Chrome/140.0 Safari/537').address, 'chrome://settings/system');
  for (const ua of ['Android Chrome/140.0 Mobile EdgA/140', 'iPhone CriOS/140', 'iPad EdgiOS/140', 'Windows Chrome/140 OPR/120', 'Firefox/140', 'Safari/617']) {
    assert.equal(browserGraphicsGuide(ua).address, '', ua);
  }
});
