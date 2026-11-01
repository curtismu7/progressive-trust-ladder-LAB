// The talk track is text: markup from the server is shown as characters, and no element is created from it.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { App } from '../src/App.jsx';
import { createApi } from '../src/api.js';
import { createFakeServer } from './fakeServer.js';

afterEach(() => cleanup());

describe('the talk track section', () => {
  it('shows the server text as text, and creates no element from markup in it', async () => {
    const fake = createFakeServer();
    render(<App api={createApi(fake.fetchImpl)} />);
    const track = await screen.findByTestId('talk-track');
    expect(track.textContent).toContain('<img src=x onerror="window.__pwned=1">Say the limits.');
    expect(track.querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });
});
