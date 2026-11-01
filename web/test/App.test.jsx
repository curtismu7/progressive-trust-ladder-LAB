import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.jsx';
import { createApi } from '../src/api.js';
import { createFakeServer } from './fakeServer.js';

afterEach(() => cleanup());
const setup = () => {
  const fake = createFakeServer();
  const api = createApi(fake.fetchImpl);
  const user = userEvent.setup();
  return { fake, user, ...render(<App api={api} />) };
};

describe('the page', () => {
  it('says MOCK on the banner and shows the four rungs with rung 0 current', async () => {
    setup();
    expect(await screen.findByText(/MOCK\. Simulated\. No bank, no PingOne tenant/)).toBeInTheDocument();
    const ladder = screen.getByRole('list', { name: 'Trust ladder' });
    expect(within(ladder).getAllByRole('listitem')).toHaveLength(4);
    expect(within(ladder).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');
  });

  it('signs in, shows the rung, and never shows a redirect login', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sign in: done. Rung 1 (Signed in).');
    expect(screen.getByRole('heading', { name: 'Your rung: Signed in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(document.body.innerHTML).not.toMatch(/authorize\?|response_mode=/);
  });

  it('a refused payment says why, in plain language, with the rung', async () => {
    const { user } = setup();
    await screen.findByRole('button', { name: 'Sign in' });
    await user.click(screen.getByRole('button', { name: 'Send payment' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Payment: Not enough trust for this payment yet. Rung 0.');
  });

  it('the mock phone lists a request and removes it when the phone approves', async () => {
    const { user, fake } = setup();
    fake.state.rung = 2;
    const amount = screen.getByLabelText(/Amount/);
    await user.clear(amount);
    await user.type(amount, '800');
    await user.click(await screen.findByRole('button', { name: 'Ask phone to approve' }));
    const approve = await screen.findByRole('button', { name: 'Approve on phone' });
    await user.click(approve);
    expect(await screen.findByText('No requests waiting.')).toBeInTheDocument();
  });

  it('text from the server is shown as text, never as markup', async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const fake = createFakeServer();
    fake.state.rung = 0;
    const api = createApi(async (url, init) => {
      if (init?.method === 'POST' && url === '/api/transact') {
        return { status: 422, json: async () => ({ ok: false, reason: hostile, rung: 0 }) };
      }
      return fake.fetchImpl(url, init);
    });
    const user = userEvent.setup();
    render(<App api={api} />);
    await user.click(await screen.findByRole('button', { name: 'Send payment' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Refused (<img src=x onerror="alert(1)">)');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('presenter mode turns on large text, hides the raw trace and keeps the banner', async () => {
    const { user, container } = setup();
    const toggle = await screen.findByRole('button', { name: /Presenter mode/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.app')).toHaveClass('app--presenter');
    expect(screen.getByTestId('banner')).toBeInTheDocument();
    expect(container.querySelector('.card--raw')).not.toBeNull(); // hidden by CSS in presenter mode, still in the DOM
  });

  it('the P key toggles presenter mode, Esc leaves it, and modifier keys and typing in a field do not', async () => {
    const { container } = setup();
    await screen.findByRole('button', { name: 'Sign in' });
    const app = () => container.querySelector('.app');
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    fireEvent.keyDown(window, { key: 'p', altKey: true });
    expect(app()).not.toHaveClass('app--presenter');
    fireEvent.keyDown(screen.getByLabelText(/Amount/), { key: 'p' });
    expect(app()).not.toHaveClass('app--presenter');
    fireEvent.keyDown(window, { key: 'p' });
    expect(app()).toHaveClass('app--presenter');
    expect(screen.getByTestId('banner')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText(/Amount/), { key: 'Escape' });
    expect(app()).not.toHaveClass('app--presenter');
    fireEvent.keyDown(window, { key: 'P' });
    expect(app()).toHaveClass('app--presenter');
  });
});

describe('the Mock | Live toggle', () => {
  it('shows Mock on, and answers Live with an honest message while staying in Mock', async () => {
    const { user } = setup();
    const mock = await screen.findByTestId('mode-mock');
    const live = screen.getByTestId('mode-live');
    expect(mock).toHaveAttribute('aria-pressed', 'true');
    expect(live).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('mode')).toHaveTextContent('Mode: mock (offline)');
    expect(screen.getByTestId('live-note')).toBeEmptyDOMElement();
    await user.click(live);
    expect(screen.getByTestId('live-note')).toHaveTextContent('Live mode is not available in this lab');
    expect(mock).toHaveAttribute('aria-pressed', 'true');
    expect(live).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('banner')).toHaveTextContent(/^MOCK\. Simulated\./);
    await user.click(mock);
    expect(screen.getByTestId('live-note')).toBeEmptyDOMElement();
  });
});

describe('buttons that cannot act', () => {
  it('are aria-disabled rather than disabled, keep focus, and do nothing when pressed', async () => {
    const { user } = setup();
    const stepUp = await screen.findByRole('button', { name: 'Step-up check' });
    expect(stepUp).toHaveAttribute('aria-disabled', 'true');
    expect(stepUp).not.toBeDisabled();
    stepUp.focus();
    await user.keyboard('{Enter}');
    expect(stepUp).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Your rung: Public' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Nothing sent yet.');
  });

  it('the diagram Stop button is aria-disabled until Simulate runs', async () => {
    setup();
    const stop = await screen.findByRole('button', { name: 'Stop' });
    expect(stop).toHaveAttribute('aria-disabled', 'true');
    expect(stop).not.toBeDisabled();
  });
});

describe('the minted proofs and the trace', () => {
  it('after sign-in the proofs panel shows the sub and acr, labelled MOCK', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    const signin = await screen.findByTestId('proof-signin');
    expect(within(signin).getByText('customer')).toBeInTheDocument();
    expect(within(signin).getByText('mock:single')).toBeInTheDocument();
    expect(within(signin).getByText(/Sign-in proof \(MOCK\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Minted proofs (MOCK)' })).toBeInTheDocument();
    expect(within(screen.getByTestId('proof-stepup')).getByText('Not minted yet.')).toBeInTheDocument();
  });

  it('the trace renders hostile text as text: no element is created and no script runs', async () => {
    const fake = createFakeServer();
    const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    const api = createApi(async (url, init) => {
      const r = await fake.fetchImpl(url, init);
      if (url === '/api/state') return { status: 200, json: async () => ({ ...(await r.json()), trace: [{ n: 1, method: 'POST', path: hostile, status: 422, reason: hostile, traceparent: null }] }) };
      return r;
    });
    render(<App api={api} />);
    const trace = await screen.findByTestId('trace');
    expect(trace.textContent).toContain('<img src=x onerror=');
    expect(trace.textContent).toContain('<script>window.__pwned=2</script>');
    expect(trace.querySelector('img,script')).toBeNull();
    expect(document.querySelector('img[src="x"], script[src]')).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });
});

describe('the flow diagram', () => {
  it('loads the diagram by name and walks its steps on Simulate', async () => {
    const { user } = setup();
    const sim = await screen.findByRole('button', { name: 'Simulate' });
    await waitFor(() => expect(sim).not.toHaveAttribute('aria-disabled'));
    await user.click(sim);
    expect(await screen.findByTestId('caption')).toHaveTextContent('Step 1 of 5: Sign in: rung 0 to rung 1.');
    expect(screen.getByRole('button', { name: 'Reset diagram' })).not.toHaveAttribute('aria-disabled');
  });
});

