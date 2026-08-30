import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const localValues = new Map<string, string>();

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
    removeItem: (key: string) => { localValues.delete(key); },
    clear: () => { localValues.clear(); },
    key: (index: number) => [...localValues.keys()][index] ?? null,
    get length() { return localValues.size; },
  } satisfies Storage,
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
